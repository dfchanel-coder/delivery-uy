import { describe, expect, it } from 'vitest';
import { ConfigurationError, loadConfig, toAppConfig, type RawEnvironment } from './environment.js';

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
      REGISTER_DEFAULT_ROLE: 'CUSTOMER',
      PASSWORD_RESET_TTL_HOURS: 2,
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
