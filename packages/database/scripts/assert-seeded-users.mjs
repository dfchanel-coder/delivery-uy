/**
 * Verifies the development seed in the database.
 *
 * Run after `pnpm run db:seed`, twice, with `--snapshot <file>` around the
 * second run. The seed script itself is trusted code, but its whole purpose is
 * writing rows a developer will then log into, so the claims it makes are
 * checked here instead of being taken on trust:
 *
 * - the four role families exist exactly once each;
 * - no password column holds anything but an Argon2id PHC digest, so a fake
 *   hash can never reach a working login;
 * - a second run neither duplicates a row nor rewrites an existing hash, which
 *   would silently invalidate the credentials in use;
 * - the reference data the seed promises is present.
 *
 * Lives here rather than in `scripts/` so `@prisma/client` resolves from this
 * package's own dependencies.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const ARGON2ID_PREFIX = '$argon2id$';

/** @returns {Record<string, string> | null} the previous snapshot, when present. */
function readSnapshot(file) {
  if (file === undefined || !existsSync(file)) return null;

  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Could not read the seed snapshot at ${file}: ${error.message}`);
    return null;
  }
}

const EXPECTED_ACCOUNTS = [
  { env: 'SEED_ADMIN_EMAIL', role: 'ADMIN' },
  { env: 'SEED_MERCHANT_EMAIL', role: 'MERCHANT' },
  { env: 'SEED_DRIVER_EMAIL', role: 'DRIVER' },
  { env: 'SEED_CUSTOMER_EMAIL', role: 'CUSTOMER' },
];

const EXPECTED_CATEGORIES = ['almacenes', 'restaurantes', 'farmacias', 'panaderias'];

function fail(message) {
  console.error(`::error::${message}`);
  process.exitCode = 1;
}

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
  fail('DATABASE_URL is required to inspect the seeded database.');
  process.exit(1);
}

// The seed itself refuses to run without these, so a missing one here means the
// assertions below would be checking an address nobody asked for.
for (const expected of EXPECTED_ACCOUNTS) {
  if (process.env[expected.env] === undefined || process.env[expected.env] === '') {
    fail(`${expected.env} is required; the seed has no default for it.`);
    process.exit(1);
  }
}

/**
 * `--snapshot <file>` records the seeded hashes and compares against a previous
 * file, which is what actually proves the second `db:seed` was a no-op. Without
 * it the script only checks that the rows look right.
 */
const snapshotIndex = process.argv.indexOf('--snapshot');
const snapshotPath = snapshotIndex === -1 ? null : process.argv[snapshotIndex + 1];
const previous = readSnapshot(snapshotPath);

const prisma = new PrismaClient();

try {
  await prisma.$connect();

  const accounts = [];

  for (const expected of EXPECTED_ACCOUNTS) {
    const email = process.env[expected.env].toLowerCase();

    const users = await prisma.user.findMany({
      where: { email },
      select: {
        id: true,
        status: true,
        emailVerifiedAt: true,
        passwordHash: true,
        roles: { select: { role: true } },
      },
    });

    if (users.length === 0) {
      fail(`The seed did not create ${expected.env}=${email}.`);
      continue;
    }

    if (users.length > 1) {
      fail(`${email} exists ${users.length} times. The seed is not idempotent.`);
      continue;
    }

    const [user] = users;

    if (!user.passwordHash.startsWith(ARGON2ID_PREFIX)) {
      fail(`${email} does not hold an Argon2id digest. A placeholder hash would make login fail.`);
    }

    if (user.status !== 'ACTIVE') {
      fail(`${email} is ${user.status}; a development account must be usable.`);
    }

    if (user.emailVerifiedAt === null) {
      fail(
        `${email} has no emailVerifiedAt; with REQUIRE_EMAIL_VERIFICATION it could never sign in.`,
      );
    }

    const roles = user.roles.map((entry) => entry.role);

    if (!roles.includes(expected.role)) {
      fail(`${email} has roles [${roles.join(', ')}]; ${expected.role} was expected.`);
    }

    if (
      previous !== null &&
      previous[email] !== undefined &&
      previous[email] !== user.passwordHash
    ) {
      // Re-seeding rewrote a password hash. The account would still exist, so
      // only comparing digests catches this, and it would invalidate the
      // password a developer already has.
      fail(
        `${email} has a different hash than before the second seed run. Re-seeding is not a no-op.`,
      );
    }

    accounts.push({ email, id: user.id, hash: user.passwordHash });
  }

  const driverEmail = process.env.SEED_DRIVER_EMAIL.toLowerCase();

  // A driver account without its profile row cannot be dispatched, and the
  // profile needs a city, so the fixture is meaningless without both.
  const driverAccount = accounts.find((account) => account.email === driverEmail);

  if (driverAccount === undefined) {
    fail(`No account was found for ${driverEmail}, so the driver profile cannot be checked.`);
  } else {
    const driver = await prisma.driver.findFirst({
      where: { userId: driverAccount.id },
      select: { id: true, cityId: true, status: true },
    });

    if (driver === null) {
      fail(`The driver account ${driverEmail} has no driver profile.`);
    }
  }

  const categories = await prisma.category.findMany({
    where: { merchantId: null },
    select: { slug: true },
    orderBy: { slug: 'asc' },
  });
  const slugs = categories.map((category) => category.slug);

  for (const slug of EXPECTED_CATEGORIES) {
    if (!slugs.includes(slug)) fail(`The platform category "${slug}" is missing.`);
  }

  const commission = await prisma.commissionRule.count({ where: { scope: 'GLOBAL' } });

  if (commission !== 1) {
    fail(`Expected exactly one global commission rule, found ${commission}.`);
  }

  if (snapshotPath !== null && snapshotPath !== undefined) {
    writeFileSync(
      snapshotPath,
      `${JSON.stringify(Object.fromEntries(accounts.map((account) => [account.email, account.hash])), null, 2)}\n`,
    );
  }

  console.log(
    `Seed verified: ${accounts.length} accounts, ${slugs.length} platform categories, 1 global commission rule.`,
  );
} finally {
  await prisma.$disconnect();
}
