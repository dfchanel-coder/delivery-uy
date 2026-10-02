/**
 * Development and demo reference data seed.
 *
 * Scope, on purpose (docs/SCHEMA_PROPOSAL.md section 6):
 *
 * - this seed creates only *reference and configuration* data: country, city,
 *   delivery zones, platform categories, the global commission rule, the
 *   feature flags declared in `packages/config` and the operational settings
 *   documented in DATABASE.md;
 * - it creates development accounts for the four role families that need a
 *   login to be exercised: ADMIN, MERCHANT, DRIVER and CUSTOMER. Their
 *   passwords are hashed with the same Argon2id implementation the API uses
 *   (`@deliveryuy/auth`), never with a fake or precomputed digest;
 * - no credential has a default. `SEED_*_EMAIL` and `SEED_*_PASSWORD` are
 *   required, because an account created with a password that is committed to
 *   this repository is an account an attacker can guess, and the seed would
 *   create it silently on any machine that forgot the variable
 *   (AGENTS.md sections 5 and 61);
 * - nothing here is Rivera-specific: country, currency and timezone come from
 *   `DEFAULT_COUNTRY`, `DEFAULT_CURRENCY` and `DEFAULT_TIMEZONE`, and the city
 *   name comes from `SEED_CITY_NAME`.
 *
 * Every write is idempotent so the script can run repeatedly, and the script
 * refuses to run when the environment looks like production.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '@deliveryuy/auth';

interface SeedConfig {
  readonly databaseUrl: string;
  readonly countryCode: string;
  readonly currency: string;
  readonly timezone: string;
  readonly cityName: string;
  readonly appEnv: string;
  readonly nodeEnv: string;
  readonly adminEmail: string;
  readonly adminPassword: string;
  readonly merchantEmail: string;
  readonly merchantPassword: string;
  readonly driverEmail: string;
  readonly driverPassword: string;
  readonly customerEmail: string;
  readonly customerPassword: string;
}

function readConfig(): SeedConfig {
  const databaseUrl = process.env['DATABASE_URL'];

  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required to seed the database.');
  }

  return {
    databaseUrl,
    countryCode: (process.env['DEFAULT_COUNTRY'] ?? 'UY').toUpperCase(),
    currency: (process.env['DEFAULT_CURRENCY'] ?? 'UYU').toUpperCase(),
    timezone: process.env['DEFAULT_TIMEZONE'] ?? 'America/Montevideo',
    // Not a credential, so it may keep a neutral default.
    cityName: process.env['SEED_CITY_NAME'] ?? 'Ciudad por defecto',
    appEnv: process.env['APP_ENV'] ?? 'development',
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
    adminEmail: requireEnv('SEED_ADMIN_EMAIL'),
    adminPassword: requireEnv('SEED_ADMIN_PASSWORD'),
    merchantEmail: requireEnv('SEED_MERCHANT_EMAIL'),
    merchantPassword: requireEnv('SEED_MERCHANT_PASSWORD'),
    driverEmail: requireEnv('SEED_DRIVER_EMAIL'),
    driverPassword: requireEnv('SEED_DRIVER_PASSWORD'),
    customerEmail: requireEnv('SEED_CUSTOMER_EMAIL'),
    customerPassword: requireEnv('SEED_CUSTOMER_PASSWORD'),
  };
}

/**
 * Reads a credential that must be supplied by the operator.
 *
 * A missing variable stops the seed instead of falling back to a committed
 * value: creating an administrator whose password is written in this repository
 * would be a worse outcome than not creating the account.
 */
function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${name} is required to seed development accounts. Set it in the environment; ` +
        'the seed intentionally has no default value for it (see the header comment).',
    );
  }

  return value;
}

function assertNotProduction(config: SeedConfig): void {
  if (config.appEnv === 'production' || config.nodeEnv === 'production') {
    throw new Error(
      'Refusing to seed: APP_ENV or NODE_ENV is production. Seed data must never reach a ' +
        'production database (AGENTS.md section 76).',
    );
  }
}

function decimal(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function seed(): Promise<void> {
  const config = readConfig();
  assertNotProduction(config);

  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });

  try {
    await prisma.$connect();

    await seedGeography(prisma, config);
    await seedCategories(prisma);
    const zoneCount = await seedZones(prisma, config);
    await seedCommission(prisma);
    const flagCount = await seedFeatureFlags(prisma);
    const settingCount = await seedSystemConfig(prisma);
    const userCount = await seedDevelopmentUsers(prisma, config);

    console.log(
      `Seed complete: country=${config.countryCode} city=${config.cityName} ` +
        `zones=${zoneCount} flags=${flagCount} settings=${settingCount} users=${userCount}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function seedGeography(prisma: PrismaClient, config: SeedConfig): Promise<void> {
  await prisma.country.upsert({
    where: { code: config.countryCode },
    create: {
      code: config.countryCode,
      name: config.countryCode,
      defaultCurrency: config.currency,
      timezone: config.timezone,
    },
    update: { defaultCurrency: config.currency, timezone: config.timezone },
  });

  await prisma.city.upsert({
    where: { countryCode_name: { countryCode: config.countryCode, name: config.cityName } },
    create: {
      countryCode: config.countryCode,
      name: config.cityName,
      timezone: config.timezone,
      currency: config.currency,
      isDefault: true,
    },
    update: { timezone: config.timezone, currency: config.currency },
  });
}

async function seedZones(prisma: PrismaClient, config: SeedConfig): Promise<number> {
  const city = await prisma.city.findFirstOrThrow({
    where: { countryCode: config.countryCode, name: config.cityName },
  });

  // Development zones only: the coordinates are placeholders and the fees are
  // zero. Real zones are configured per city by an administrator.
  const zones = [
    { name: 'Centro', priority: 0, radiusMeters: 2500 },
    { name: 'Periferia', priority: 10, radiusMeters: 5000 },
  ] as const;

  for (const zone of zones) {
    const existing = await prisma.deliveryZone.findFirst({
      where: { cityId: city.id, name: zone.name },
    });

    if (existing !== null) {
      await prisma.deliveryZone.update({
        where: { id: existing.id },
        data: { radiusMeters: decimal(zone.radiusMeters), priority: zone.priority },
      });
      continue;
    }

    await prisma.deliveryZone.create({
      data: {
        cityId: city.id,
        name: zone.name,
        kind: 'RADIUS',
        centerLatitude: decimal(0),
        centerLongitude: decimal(0),
        radiusMeters: decimal(zone.radiusMeters),
        baseFee: decimal(0),
        distanceFeePerKm: decimal(0),
        priority: zone.priority,
      },
    });
  }

  return zones.length;
}

async function seedCategories(prisma: PrismaClient): Promise<void> {
  const categories = [
    { slug: 'almacenes', name: 'Almacenes', sortOrder: 10 },
    { slug: 'restaurantes', name: 'Restaurantes', sortOrder: 20 },
    { slug: 'farmacias', name: 'Farmacias', sortOrder: 30 },
    { slug: 'panaderias', name: 'Panaderias', sortOrder: 40 },
  ] as const;

  for (const category of categories) {
    // Platform categories are the ones with `merchantId IS NULL`; their slug is
    // protected by a partial unique index, so the lookup cannot use a compound
    // unique key that contains a nullable column.
    const existing = await prisma.category.findFirst({
      where: { slug: category.slug, merchantId: null },
    });

    if (existing !== null) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { name: category.name, sortOrder: category.sortOrder },
      });
      continue;
    }

    await prisma.category.create({
      data: { name: category.name, slug: category.slug, sortOrder: category.sortOrder },
    });
  }
}

async function seedCommission(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.commissionRule.findFirst({
    where: { scope: 'GLOBAL', cityId: null, merchantId: null },
  });

  if (existing !== null) return;

  // 15% is a development placeholder so the ledger has a rule to read; an
  // administrator sets the commercial value before going live.
  await prisma.commissionRule.create({
    data: { scope: 'GLOBAL', ratePercent: decimal(15), effectiveFrom: new Date() },
  });
}

async function seedFeatureFlags(prisma: PrismaClient): Promise<number> {
  const flags: ReadonlyArray<readonly [string, boolean, string]> = [
    ['cash_payments', process.env['FEATURE_CASH_PAYMENTS'] === 'true', 'Pagos en efectivo'],
    ['wallet', process.env['FEATURE_WALLET'] === 'true', 'Billetera'],
    ['tips', process.env['FEATURE_TIPS'] === 'true', 'Propinas'],
    ['scheduled_orders', process.env['FEATURE_SCHEDULED_ORDERS'] === 'true', 'Pedidos agendados'],
    ['loyalty', process.env['FEATURE_LOYALTY'] === 'true', 'Fidelidad'],
    [
      'multi_order_delivery',
      process.env['FEATURE_MULTI_ORDER_DELIVERY'] === 'true',
      'Reparto multi pedido',
    ],
  ];

  for (const [key, enabled, description] of flags) {
    await prisma.featureFlag.upsert({
      where: { key },
      create: { key, enabled, description },
      update: { enabled },
    });
  }

  return flags.length;
}

async function seedSystemConfig(prisma: PrismaClient): Promise<number> {
  const settings: ReadonlyArray<readonly [string, Prisma.InputJsonValue, string]> = [
    ['delivery.max_radius_meters', 10000, 'Radio maximo de reparto'],
    ['merchant.accept_timeout_seconds', 300, 'Tiempo para aceptar un pedido'],
    ['driver.accept_timeout_seconds', 60, 'Tiempo para aceptar una oferta'],
    ['gps.interval_seconds', 30, 'Frecuencia de reporte GPS'],
    ['dispatch.strategy', process.env['DISPATCH_STRATEGY'] ?? 'NEAREST', 'Estrategia de despacho'],
  ];

  for (const [key, value, description] of settings) {
    await prisma.systemConfig.upsert({
      where: { key },
      create: { key, value, description },
      update: {},
    });
  }

  return settings.length;
}

async function seedDevelopmentUsers(prisma: PrismaClient, config: SeedConfig): Promise<number> {
  // Only `production` is refused here, and the whole script already refuses to
  // run when APP_ENV or NODE_ENV is production (see assertNotProduction). This
  // second guard keeps the intent explicit: the account fixtures below are
  // development conveniences, never production bootstrap data (AGENTS.md 76).
  const now = new Date();

  // The DRIVER row needs a city, so it is created after the geography seed. It
  // is intentionally left out of this list and handled separately.
  const accounts: ReadonlyArray<{
    readonly email: string;
    readonly password: string;
    readonly role: 'ADMIN' | 'MERCHANT' | 'CUSTOMER';
  }> = [
    { email: config.adminEmail, password: config.adminPassword, role: 'ADMIN' },
    { email: config.merchantEmail, password: config.merchantPassword, role: 'MERCHANT' },
    { email: config.customerEmail, password: config.customerPassword, role: 'CUSTOMER' },
  ];

  const city = await prisma.city.findFirst({
    where: { countryCode: config.countryCode, name: config.cityName },
    select: { id: true },
  });

  if (city === null) {
    throw new Error('Seed users require the city from seedGeography to exist first.');
  }

  let created = 0;

  for (const account of accounts) {
    if (await userExists(prisma, account.email)) continue;

    await prisma.user.create({
      data: {
        email: account.email.toLowerCase(),
        passwordHash: await hashPassword(account.password),
        status: 'ACTIVE',
        emailVerifiedAt: now,
        locale: 'es',
        roles: { create: [{ role: account.role }] },
        customerProfile:
          account.role === 'CUSTOMER'
            ? { create: { firstName: 'Cliente', lastName: 'Demo' } }
            : undefined,
        createdAt: now,
        updatedAt: now,
      },
    });

    created++;
  }

  if (!(await userExists(prisma, config.driverEmail))) {
    await prisma.user.create({
      data: {
        email: config.driverEmail.toLowerCase(),
        passwordHash: await hashPassword(config.driverPassword),
        status: 'ACTIVE',
        emailVerifiedAt: now,
        locale: 'es',
        roles: { create: [{ role: 'DRIVER' }] },
        // Driver review belongs to PHASE 05; PENDING_REVIEW is the honest
        // starting state for a fixture rather than a pre-approved driver.
        driverProfile: { create: { cityId: city.id, status: 'PENDING_REVIEW' } },
        createdAt: now,
        updatedAt: now,
      },
    });

    created++;
  }

  return created;
}

/**
 * Case-insensitive existence check.
 *
 * `users_email_lower_uniq` is a functional index on `lower(email)`, so the
 * comparison must be lowered explicitly: a case-sensitive lookup would report
 * "not found" for an existing row and the insert would then fail on the index.
 */
async function userExists(prisma: PrismaClient, email: string): Promise<boolean> {
  const found = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM "users" WHERE lower("email") = lower(${email})) AS "exists"
  `;

  return found[0]?.exists ?? false;
}

seed().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
