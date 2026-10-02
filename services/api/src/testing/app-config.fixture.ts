import type { AppConfig } from '@deliveryuy/config';

/** Recursive partial, so a test can override one nested field without a cast. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

function merge<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (overrides === undefined) return base;

  const result = { ...base } as Record<string, unknown>;

  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    const current = result[key];

    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== undefined &&
      current !== null &&
      typeof current === 'object'
    ) {
      result[key] = merge(current as object, value as DeepPartial<object>) as T[keyof T];
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

/**
 * A complete, valid `AppConfig` for tests.
 *
 * The application configuration is validated at startup and every module reads it
 * through `AppConfigService`, so a test that hand-writes a partial literal has to
 * be updated every time a key is added. This factory keeps those tests compiling
 * and states the defaults in one readable place.
 *
 * The values are deliberately cheap: Argon2 runs with the smallest permitted cost
 * so the suite is not dominated by hashing, and the JWT secrets are obviously
 * non-production.
 */
export function testAppConfig(overrides: DeepPartial<AppConfig> = {}): AppConfig {
  const base: AppConfig = {
    env: 'test',
    isProduction: false,
    service: {
      name: 'api',
      port: 3000,
      internalPort: 3001,
      url: 'http://localhost:3000',
      bodyLimit: '1mb',
      corsOrigins: [],
    },
    database: { url: 'postgresql://localhost:5432/test', poolSize: 1 },
    redis: { url: 'redis://localhost:6379' },
    health: { timeoutMs: 100 },
    auth: {
      accessSecret: 'a'.repeat(40),
      refreshSecret: 'b'.repeat(40),
      accessExpiresIn: '15m',
      refreshExpiresIn: '30d',
      issuer: 'deliveryuy',
      audience: 'deliveryuy-clients',
      loginMaxAttempts: 5,
      loginLockMinutes: 15,
      passwordArgon2MemoryKib: 8192,
      passwordArgon2Iterations: 1,
      passwordMinLength: 10,
      requireEmailVerification: false,
      registerDefaultRole: 'CUSTOMER',
      passwordResetTtlHours: 2,
      trustProxyHops: 0,
    },
    rateLimit: { backend: 'memory' },
    deliveryCode: { length: 6, numericOnly: true, ttlHours: 24, maxAttempts: 5, lockMinutes: 15 },
    dispatch: {
      strategy: 'proximity-v1',
      batchSize: 5,
      offerTtlSeconds: 45,
      maxRounds: 10,
      crossCity: false,
    },
    gps: {
      intervalSeconds: 5,
      positionTtlSeconds: 120,
      historyEnabled: false,
      historyRetentionHours: 24,
    },
    defaults: { country: 'UY', currency: 'UYU', timezone: 'America/Montevideo' },
    retention: {
      runtimeConfigCacheSeconds: 30,
      sessionDays: 30,
      idempotencyDays: 7,
      webhookEventDays: 30,
      outboxDays: 7,
    },
    providers: {
      map: { provider: 'none' },
      payment: { provider: 'none' },
      billing: { provider: 'none' },
      notification: { provider: 'none' },
      storage: { provider: 'local', localPath: './var/storage' },
    },
    observability: { logLevel: 'silent', otelEnabled: false },
    featureFlags: {},
  };

  return merge(base, overrides);
}
