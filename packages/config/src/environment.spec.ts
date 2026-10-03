import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  environmentKeys,
  loadConfig,
  toAppConfig,
  type RawEnvironment,
} from './environment.js';

function baseEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://delivery:delivery@localhost:5432/deliveryuy_test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
    JWT_REFRESH_SECRET: 'b'.repeat(40),
    ...overrides,
  };
}

describe('loadConfig', () => {
  it('returns frozen configuration with documented defaults', () => {
    const config = loadConfig(baseEnv());

    expect(Object.isFrozen(config)).toBe(true);
    expect(config.deliveryCode.length).toBe(6);
    expect(config.deliveryCode.maxAttempts).toBe(5);
    expect(config.dispatch.strategy).toBe('proximity-v1');
    expect(config.defaults.currency).toBe('UYU');
    expect(config.auth.loginMaxAttempts).toBe(5);
  });

  it('never hardcodes a city: country, currency and timezone come from the environment', () => {
    const config = loadConfig(
      baseEnv({
        DEFAULT_COUNTRY: 'BR',
        DEFAULT_CURRENCY: 'BRL',
        DEFAULT_TIMEZONE: 'America/Sao_Paulo',
      }),
    );

    expect(config.defaults).toEqual({
      country: 'BR',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('rejects a missing database url', () => {
    const env = baseEnv();
    delete env['DATABASE_URL'];

    expect(() => loadConfig(env)).toThrow(ConfigurationError);
  });

  it('rejects the CHANGE_ME placeholder secret', () => {
    expect(() =>
      loadConfig(baseEnv({ JWT_ACCESS_SECRET: 'CHANGE_ME', JWT_REFRESH_SECRET: 'c'.repeat(40) })),
    ).toThrow(/CHANGE_ME placeholder/);
  });

  it('rejects identical access and refresh secrets', () => {
    expect(() =>
      loadConfig(
        baseEnv({ JWT_ACCESS_SECRET: 'x'.repeat(40), JWT_REFRESH_SECRET: 'x'.repeat(40) }),
      ),
    ).toThrow(/must differ/);
  });

  it('rejects delivery code length outside 4-6 (ADR-010)', () => {
    expect(() => loadConfig(baseEnv({ DELIVERY_CODE_LENGTH: '3' }))).toThrow(
      /DELIVERY_CODE_LENGTH/,
    );
    expect(() => loadConfig(baseEnv({ DELIVERY_CODE_LENGTH: '7' }))).toThrow(
      /DELIVERY_CODE_LENGTH/,
    );
  });

  it('refuses to require email verification while no provider can deliver it', () => {
    // Verification is a promise the deployment has to be able to keep: with no
    // notification provider nobody would ever receive the message, and every
    // account would stay unusable.
    expect(() =>
      loadConfig(baseEnv({ REQUIRE_EMAIL_VERIFICATION: 'true', NOTIFICATION_PROVIDER: 'none' })),
    ).toThrow(/REQUIRE_EMAIL_VERIFICATION/);
  });

  it('refuses SMTP without a host, a port and a sender', () => {
    // Selecting SMTP claims a message can leave the process. Discovered at
    // startup instead of on the first password reset somebody requests.
    expect(() =>
      loadConfig(
        baseEnv({ NOTIFICATION_PROVIDER: 'smtp', SMTP_PORT: '587', SMTP_FROM: 'a@b.example' }),
      ),
    ).toThrow(/SMTP_HOST/);
    expect(() =>
      loadConfig(
        baseEnv({
          NOTIFICATION_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.example',
          SMTP_FROM: 'a@b.example',
        }),
      ),
    ).toThrow(/SMTP_PORT/);
    expect(() =>
      loadConfig(
        baseEnv({
          NOTIFICATION_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.example',
          SMTP_PORT: '587',
        }),
      ),
    ).toThrow(/SMTP_FROM/);
  });

  it('refuses half an SMTP credential pair', () => {
    const complete = {
      NOTIFICATION_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example',
      SMTP_PORT: '587',
      SMTP_FROM: 'a@b.example',
    };

    expect(() => loadConfig(baseEnv({ ...complete, SMTP_USER: 'apikey' }))).toThrow(
      /SMTP_PASSWORD/,
    );
    expect(() => loadConfig(baseEnv({ ...complete, SMTP_PASSWORD: 'secret' }))).toThrow(
      /SMTP_USER/,
    );
  });

  it('refuses SMTP credentials on a port that would send them in clear text', () => {
    expect(() =>
      loadConfig(
        baseEnv({
          NOTIFICATION_PROVIDER: 'smtp',
          SMTP_HOST: 'smtp.example',
          SMTP_PORT: '25',
          SMTP_FROM: 'a@b.example',
          SMTP_USER: 'apikey',
          SMTP_PASSWORD: 'secret',
        }),
      ),
    ).toThrow(/submission port/);
  });

  it('lets a development machine talk to a local sink without TLS', () => {
    // Mailpit and friends listen on a self-signed or plaintext port. Refusing
    // that outright would leave no way to see a real message on a laptop.
    const config = loadConfig(
      baseEnv({
        NOTIFICATION_PROVIDER: 'smtp',
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '2525',
        SMTP_FROM: 'no-reply@deliveryuy.example',
        SMTP_REQUIRE_TLS: 'false',
      }),
    );

    expect(config.providers.notification.smtp?.requireTls).toBe(false);
  });

  it('refuses to drop TLS where a code would cross the network', () => {
    const complete = {
      NOTIFICATION_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.example',
      SMTP_PORT: '587',
      SMTP_FROM: 'a@b.example',
      SMTP_REQUIRE_TLS: 'false',
    };

    // Even in development: the codes in these messages are bearer credentials.
    expect(() =>
      loadConfig(baseEnv({ ...complete, SMTP_USER: 'apikey', SMTP_PASSWORD: 'secret' })),
    ).toThrow(/SMTP_REQUIRE_TLS|requireTls/i);

    // And unconditionally once the deployment is not a laptop.
    expect(() => loadConfig(baseEnv({ ...complete, APP_ENV: 'production' }))).toThrow(
      /must stay enabled outside development/,
    );
  });

  it('exposes the SMTP settings only when the provider is smtp', () => {
    const smtp = loadConfig(
      baseEnv({
        NOTIFICATION_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example',
        SMTP_PORT: '587',
        SMTP_FROM: 'no-reply@deliveryuy.example',
      }),
    );

    expect(smtp.providers.notification.smtp).toEqual({
      host: 'smtp.example',
      port: 587,
      secure: false,
      requireTls: true,
      user: undefined,
      password: undefined,
    });

    // A half-configured SMTP block would let a caller believe delivery works.
    const none = loadConfig(baseEnv({ NOTIFICATION_PROVIDER: 'none', SMTP_HOST: 'smtp.example' }));

    expect(none.providers.notification.smtp).toBeUndefined();
  });

  it('treats port 465 as implicit TLS', () => {
    const smtp = loadConfig(
      baseEnv({
        NOTIFICATION_PROVIDER: 'smtp',
        SMTP_HOST: 'smtp.example',
        SMTP_PORT: '465',
        SMTP_FROM: 'no-reply@deliveryuy.example',
        SMTP_USER: 'apikey',
        SMTP_PASSWORD: 'secret',
      }),
    );

    expect(smtp.providers.notification.smtp?.secure).toBe(true);
  });

  it('refuses an elevated self-registration role', () => {
    // Self-registration must not be able to hand out a role that grants
    // administrative or operational permissions (AGENTS.md section 32).
    expect(() => loadConfig(baseEnv({ REGISTER_DEFAULT_ROLE: 'ADMIN' }))).toThrow(
      /REGISTER_DEFAULT_ROLE/,
    );
    expect(() => loadConfig(baseEnv({ REGISTER_DEFAULT_ROLE: 'MERCHANT' }))).toThrow(
      /REGISTER_DEFAULT_ROLE/,
    );
  });

  it('rejects an unknown rate limit backend', () => {
    expect(() => loadConfig(baseEnv({ RATE_LIMIT_BACKEND: 'memcached' }))).toThrow(
      /RATE_LIMIT_BACKEND/,
    );
  });

  it('collects every problem in a single error', () => {
    const env = baseEnv({ API_PORT: 'not-a-port', LOGIN_MAX_ATTEMPTS: '0' });
    const error = (() => {
      try {
        loadConfig(env);
        return null;
      } catch (thrown: unknown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(ConfigurationError);
    expect((error as ConfigurationError).issues.length).toBeGreaterThanOrEqual(2);
  });

  it('requires https, non-local storage and a payment provider in production', () => {
    expect(() => loadConfig(baseEnv({ APP_ENV: 'production', NODE_ENV: 'production' }))).toThrow(
      /https/,
    );

    expect(() =>
      loadConfig(
        baseEnv({
          APP_ENV: 'production',
          NODE_ENV: 'production',
          API_URL: 'https://api.deliveryuy.uy',
          STORAGE_PROVIDER: 'local',
        }),
      ),
    ).toThrow(/STORAGE_PROVIDER/);

    expect(() =>
      loadConfig(
        baseEnv({
          APP_ENV: 'production',
          NODE_ENV: 'production',
          API_URL: 'https://api.deliveryuy.uy',
          STORAGE_PROVIDER: 's3',
        }),
      ),
    ).toThrow(/PAYMENT_PROVIDER/);
  });

  it('accepts a fully specified production configuration', () => {
    const config = loadConfig(
      baseEnv({
        APP_ENV: 'production',
        NODE_ENV: 'production',
        API_URL: 'https://api.deliveryuy.uy',
        STORAGE_PROVIDER: 's3',
        PAYMENT_PROVIDER: 'mercadopago',
        AWS_REGION: 'us-east-1',
        AWS_BUCKET: 'deliveryuy-prod',
      }),
    );

    expect(config.isProduction).toBe(true);
  });

  it('parses booleanish values coming from the environment', () => {
    expect(loadConfig(baseEnv({ FEATURE_TIPS: 'true' })).featureFlags['tips']).toBe(true);
    expect(loadConfig(baseEnv({ FEATURE_TIPS: 'off' })).featureFlags['tips']).toBe(false);
    expect(loadConfig(baseEnv({ DELIVERY_CODE_NUMERIC_ONLY: 'no' })).deliveryCode.numericOnly).toBe(
      false,
    );
  });

  it('splits cors origins and drops empty entries', () => {
    const config = loadConfig(
      baseEnv({ CORS_ORIGINS: 'http://localhost:3001, https://admin.deliveryuy.uy ,' }),
    );

    expect(config.service.corsOrigins).toEqual([
      'http://localhost:3001',
      'https://admin.deliveryuy.uy',
    ]);
  });
});

describe('toAppConfig', () => {
  it('freezes nested sections so callers cannot mutate shared configuration', () => {
    const config = loadConfig(baseEnv());

    expect(Object.isFrozen(config.auth)).toBe(true);
    expect(Object.isFrozen(config.providers)).toBe(true);
    expect(() => {
      (config.auth as { accessSecret: string }).accessSecret = 'mutated';
    }).toThrow(TypeError);
  });

  it('is a pure mapping from a validated environment', () => {
    const env = {
      APP_ENV: 'development',
      NODE_ENV: 'development',
      SERVICE_NAME: 'api',
      API_PORT: 3000,
      API_INTERNAL_PORT: 3001,
      API_URL: 'http://localhost:3000',
      API_BODY_LIMIT: '1mb',
      CORS_ORIGINS: 'http://localhost:3001',
      DATABASE_URL: 'postgresql://localhost:5432/x',
      DATABASE_POOL_SIZE: 10,
      REDIS_URL: 'redis://localhost:6379',
      HEALTH_CHECK_TIMEOUT_MS: 2000,
      JWT_ACCESS_SECRET: 'a'.repeat(40),
      JWT_REFRESH_SECRET: 'b'.repeat(40),
      JWT_ACCESS_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '30d',
      JWT_ISSUER: 'deliveryuy',
      JWT_AUDIENCE: 'deliveryuy-clients',
      LOGIN_MAX_ATTEMPTS: 5,
      LOGIN_LOCK_MINUTES: 15,
      PASSWORD_ARGON2_MEMORY_KIB: 65536,
      PASSWORD_ARGON2_ITERATIONS: 3,
      PASSWORD_MIN_LENGTH: 10,
      REQUIRE_EMAIL_VERIFICATION: false,
      ACCOUNT_APPROVAL_REQUIRED: false,
      REGISTER_DEFAULT_ROLE: 'CUSTOMER',
      PASSWORD_RESET_TTL_HOURS: 2,
      EMAIL_VERIFICATION_TTL_HOURS: 24,
      TRUST_PROXY_HOPS: 0,
      RATE_LIMIT_BACKEND: 'redis',
      DELIVERY_CODE_LENGTH: 6,
      DELIVERY_CODE_NUMERIC_ONLY: true,
      DELIVERY_CODE_TTL_HOURS: 24,
      DELIVERY_CODE_MAX_ATTEMPTS: 5,
      DELIVERY_CODE_LOCK_MINUTES: 15,
      DISPATCH_STRATEGY: 'proximity-v1',
      DISPATCH_BATCH_SIZE: 5,
      DISPATCH_OFFER_TTL_SECONDS: 45,
      DISPATCH_MAX_ROUNDS: 10,
      CROSS_CITY_DISPATCH: false,
      GPS_INTERVAL_SECONDS: 5,
      GPS_POSITION_TTL_SECONDS: 120,
      GPS_HISTORY_ENABLED: false,
      GPS_HISTORY_RETENTION_HOURS: 24,
      DEFAULT_COUNTRY: 'UY',
      DEFAULT_CURRENCY: 'UYU',
      DEFAULT_TIMEZONE: 'America/Montevideo',
      RUNTIME_CONFIG_CACHE_TTL_SECONDS: 30,
      SESSION_RETENTION_DAYS: 30,
      IDEMPOTENCY_RETENTION_DAYS: 7,
      WEBHOOK_EVENT_RETENTION_DAYS: 30,
      OUTBOX_RETENTION_DAYS: 7,
      MAP_PROVIDER: 'none',
      GOOGLE_MAPS_API_KEY: undefined,
      MAPBOX_TOKEN: undefined,
      PAYMENT_PROVIDER: 'none',
      MERCADO_PAGO_ACCESS_TOKEN: undefined,
      MERCADO_PAGO_WEBHOOK_SECRET: undefined,
      BILLING_PROVIDER: 'none',
      NOTIFICATION_PROVIDER: 'none',
      STORAGE_PROVIDER: 'local',
      STORAGE_LOCAL_PATH: './var/storage',
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_REGION: undefined,
      AWS_BUCKET: undefined,
      FIREBASE_PROJECT_ID: undefined,
      SMTP_HOST: undefined,
      SMTP_PORT: undefined,
      SMTP_USER: undefined,
      SMTP_PASSWORD: undefined,
      SMTP_FROM: undefined,
      SMTP_REQUIRE_TLS: true,
      LOG_LEVEL: 'info',
      OTEL_ENABLED: false,
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      FEATURE_CASH_PAYMENTS: false,
      FEATURE_WALLET: false,
      FEATURE_TIPS: false,
      FEATURE_SCHEDULED_ORDERS: false,
      FEATURE_LOYALTY: false,
      FEATURE_MULTI_ORDER_DELIVERY: false,
    } satisfies RawEnvironment;

    expect(toAppConfig(env).service.name).toBe('api');
  });
});

/**
 * Finds a repository file by walking up from the working directory.
 *
 * `import.meta.url` is not available: this package compiles to CommonJS, and a
 * relative path from `process.cwd()` would silently depend on the test runner
 * being started at the repository root. Walking up finds the same file whether
 * the gate runs from the root or from inside this package, and throws loudly
 * when it does not exist instead of testing a file nobody wrote.
 */
function repositoryFile(relativePath: string): string {
  let directory = process.cwd();

  for (;;) {
    const candidate = join(directory, relativePath);

    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`Could not find ${relativePath} above ${process.cwd()}`);
    }

    directory = parent;
  }
}

/**
 * `.env.example` is the only place an operator learns a variable exists.
 *
 * A key the schema reads but the example omits is invisible until the process
 * refuses to start, and three of them had already drifted that way. This test is
 * what makes the claim in PROJECT_STATE.md true rather than aspirational.
 */
describe('.env.example', () => {
  const example = readFileSync(repositoryFile('.env.example'), 'utf8');

  const declaredLines = example
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  const declaredKeys = new Set(declaredLines.map((line) => line.slice(0, line.indexOf('='))));

  it('declares every key the schema reads', () => {
    const missing = environmentKeys.filter((key) => !declaredKeys.has(key));

    expect(missing).toEqual([]);
  });

  it('declares nothing the schema does not read, except what the seed owns', () => {
    // `.env.example` documents the whole repository, not one process. The seed is
    // the other consumer: it validates its own variables, so its keys are not in
    // the API schema and must not be forced into it.
    const schemaKeys = new Set(environmentKeys);
    const seedSource = readFileSync(repositoryFile('packages/database/prisma/seed.ts'), 'utf8');

    const unowned = [...declaredKeys].filter(
      (key) => !schemaKeys.has(key) && !seedSource.includes(key),
    );

    // A key in the example that nothing reads is an operator setting something
    // with no effect, which reads as a bug.
    expect(unowned).toEqual([]);
  });

  it('never carries a credential-shaped value that could be mistaken for a real one', () => {
    // `CHANGE_ME` is deliberate: it is the one value the schema and the seed
    // refuse at runtime, so shipping it is what makes the example honest rather
    // than a working default. Anything else non-empty is a real credential that
    // reached the repository.
    //
    // The key test is deliberately narrow. `PASSWORD_MIN_LENGTH` and
    // `PASSWORD_RESET_TTL_HOURS` name a policy, not a secret, and a loose
    // substring match would read them as credentials.
    const isCredentialKey = (key: string): boolean =>
      key.includes('SECRET') || /(PASSWORD|TOKEN|KEY|KEY_ID)$/.test(key);

    const usable = [...declaredLines]
      .filter((line) => isCredentialKey(line.slice(0, line.indexOf('='))))
      .map((line) => line.slice(line.indexOf('=') + 1))
      .filter((value) => value.length > 0 && !value.startsWith('CHANGE_ME'));

    expect(usable).toEqual([]);
  });
});
