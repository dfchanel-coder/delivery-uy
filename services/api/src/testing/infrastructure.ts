/**
 * Real-infrastructure guard for the integration suite.
 *
 * The Prisma adapters and the Redis rate limiter are only proven against real
 * infrastructure (ADR-016). Their correctness depends on behaviour a test double
 * cannot reproduce: a partial functional index, a conditional `updateMany`
 * losing a race, transaction rollback after a thrown error, and a Lua script
 * executing as one atomic step inside Redis.
 *
 * Resources are opened from a `beforeAll` hook rather than at module load,
 * because this package compiles to CommonJS and top-level `await` is not
 * available. A spec then calls {@link withDatabase} or {@link withRedis} inside
 * each test: it runs the body with the connection, or marks the test skipped
 * with a reason.
 *
 * Skipping keeps `pnpm test` usable on a machine without Docker, but a silent
 * pass would be indistinguishable from a real one, so the CI `integration` job
 * reads the vitest JSON report and fails if anything was skipped
 * (`scripts/assert-integration-report.mjs`).
 */
import Redis from 'ioredis';
import { createDatabaseClient, type PrismaClient } from '@deliveryuy/database';

export const NO_DATABASE =
  'No migrated PostgreSQL reachable. Run "pnpm infra:test" (Docker) or use the CI integration job.';

export const NO_REDIS =
  'No Redis reachable. Run "pnpm infra:test" (Docker) or use the CI integration job.';

/**
 * Outcome of trying to reach a dependency.
 *
 * A discriminated union rather than `T | null` plus a separate `reason`, so the
 * compiler enforces that a reason exists whenever the value does not.
 */
export type Reach<T> =
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'unavailable'; readonly reason: string };

/** The part of vitest's test context these helpers use. */
export interface Skippable {
  skip: (note?: string) => void;
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------

let database: Reach<PrismaClient> | null = null;

/**
 * Opens the shared PostgreSQL connection for the current spec file, at most once.
 *
 * Reports *unavailable* rather than throwing when the server is unreachable, and
 * also when it is reachable but unmigrated: against an unmigrated database every
 * repository test fails on a missing relation, which reads like an adapter bug
 * and hides the real cause.
 */
export async function openDatabase(): Promise<Reach<PrismaClient>> {
  if (database !== null) return database;

  const url = process.env['DATABASE_URL'];

  if (url === undefined || url === '') {
    database = { status: 'unavailable', reason: NO_DATABASE };
    return database;
  }

  const client = createDatabaseClient({ url, poolSize: 4, logLevel: 'error' });

  try {
    await client.$connect();
    await client.$queryRawUnsafe('SELECT 1');

    const applied = await client.$queryRawUnsafe<Array<{ count: bigint }>>(
      'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );

    if (Number(applied[0]?.count ?? 0n) === 0) {
      await client.$disconnect().catch(() => undefined);
      database = {
        status: 'unavailable',
        reason: `${NO_DATABASE} The "_prisma_migrations" table is empty, so "pnpm run db:deploy" has not run.`,
      };
      return database;
    }

    database = { status: 'ready', value: client };
    return database;
  } catch (error: unknown) {
    await client.$disconnect().catch(() => undefined);
    database = { status: 'unavailable', reason: `${NO_DATABASE} (${describeCause(error)})` };
    return database;
  }
}

/** Closes the shared connection. Safe to call when none was opened. */
export async function closeDatabase(): Promise<void> {
  if (database?.status === 'ready') await database.value.$disconnect().catch(() => undefined);
  database = null;
}

/**
 * Runs a test body against PostgreSQL, or marks the test skipped.
 *
 * `ctx.skip()` marks the test but does not stop the body, so the early return is
 * what actually prevents the assertions from running without a database.
 */
export async function withDatabase(
  ctx: Skippable,
  build: (client: PrismaClient) => Promise<void>,
): Promise<void> {
  if (database === null) await openDatabase();

  if (database?.status !== 'ready') {
    ctx.skip(database?.reason ?? NO_DATABASE);
    return;
  }

  await build(database.value);
}

/**
 * True when the hand-written case-insensitive email index exists.
 *
 * `PrismaUserRepository.findByEmail` issues `lower(u.email) = lower($1)` precisely
 * because this functional index exists. If a future migration dropped it, the
 * query would keep returning the right row but degrade into a sequential scan of
 * `users` on every login, so the index is asserted rather than assumed.
 */
export async function hasEmailFunctionalIndex(client: PrismaClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE tablename = 'users' AND indexname = 'users_email_lower_uniq'
     ) AS "exists"`,
  );

  return rows[0]?.exists ?? false;
}

/**
 * Clears the tables the auth integration tests write.
 *
 * Explicit table names rather than trusting cascade behaviour: a test must not
 * start passing because an unrelated relation happens to cascade today.
 */
export async function truncateAuthTables(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "sessions", "password_reset_tokens", "user_roles", "risk_events", "users" RESTART IDENTITY CASCADE',
  );
}

/**
 * Truncates the auth tables before each test, when a database is available.
 *
 * A no-op otherwise, so `beforeEach` needs no skip handling of its own: the
 * tests themselves skip through {@link withDatabase}. Truncating per test keeps
 * the specs independent of execution order.
 */
export async function resetAuthTables(): Promise<void> {
  if (database === null) await openDatabase();
  if (database?.status === 'ready') await truncateAuthTables(database.value);
}

/** Deletes only the keys this suite created. */
export async function deleteTestKeys(client: Redis, pattern: string): Promise<void> {
  const keys = await client.keys(pattern);

  if (keys.length > 0) await client.del(...keys);
}

/**
 * Clears the tables the admin, audit and platform integration tests write.
 *
 * Kept separate from `truncateAuthTables` because the two suites clean up
 * disjoint sets: this one must not depend on a future auth table disappearing
 * an audit fixture, or the other way around. `risk_events` appears in both, and
 * TRUNCATE is idempotent, so the overlap is safe.
 */
export async function truncateAdminTables(client: PrismaClient): Promise<void> {
  await client.$executeRawUnsafe(
    'TRUNCATE TABLE "audit_logs", "feature_flags", "risk_events" RESTART IDENTITY CASCADE',
  );
}

/** Truncates the admin/audit/platform tables before each test, when reachable. */
export async function resetAdminTables(): Promise<void> {
  if (database === null) await openDatabase();
  if (database?.status === 'ready') await truncateAdminTables(database.value);
}

// ---------------------------------------------------------------------------
// Redis
// ---------------------------------------------------------------------------

let redis: Reach<Redis> | null = null;

/** Opens the shared Redis connection for the current spec file, at most once. */
export async function openRedis(): Promise<Reach<Redis>> {
  if (redis !== null) return redis;

  const url = process.env['REDIS_URL'];

  if (url === undefined || url === '') {
    redis = { status: 'unavailable', reason: NO_REDIS };
    return redis;
  }

  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });

  try {
    await client.connect();
    await client.ping();
    redis = { status: 'ready', value: client };
  } catch (error: unknown) {
    client.disconnect();
    redis = { status: 'unavailable', reason: `${NO_REDIS} (${describeCause(error)})` };
  }

  return redis;
}

/** Closes the shared connection. Safe to call when none was opened. */
export async function closeRedis(): Promise<void> {
  if (redis?.status === 'ready') await redis.value.quit().catch(() => undefined);
  redis = null;
}

/** Runs a test body against Redis, or marks the test skipped. */
export async function withRedis(
  ctx: Skippable,
  build: (client: Redis) => Promise<void>,
): Promise<void> {
  if (redis === null) await openRedis();

  if (redis?.status !== 'ready') {
    ctx.skip(redis?.reason ?? NO_REDIS);
    return;
  }

  await build(redis.value);
}
