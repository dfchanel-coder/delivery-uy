import { z } from 'zod';

/**
 * Bootstrap configuration schema (ADR-013 layer 1).
 *
 * Rules enforced here:
 * - the process refuses to start with invalid configuration;
 * - secrets have no default value and must be replaced outside development;
 * - operational tunables have explicit defaults instead of magic constants in
 *   business logic (AGENTS.md section 52);
 * - no city is hardcoded (AGENTS.md section 45).
 */

const placeholderSecret = 'CHANGE_ME';

const durationPattern = /^\d+(ms|s|m|h|d)$/;

const booleanish = (
  defaultValue: boolean,
): z.ZodType<boolean, z.ZodTypeDef, boolean | string | undefined> =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return defaultValue;
      if (typeof value === 'boolean') return value;
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    });

const secretSchema = z
  .string({ required_error: 'is required' })
  .min(32, 'must be at least 32 characters')
  .refine((value) => !value.includes(placeholderSecret), {
    message: 'still contains the CHANGE_ME placeholder from .env.example',
  });

export const appEnvSchema = z.enum(['development', 'test', 'staging', 'production']);

export const environmentSchema = z
  .object({
    // --- runtime -------------------------------------------------------
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: appEnvSchema.default('development'),
    SERVICE_NAME: z.string().min(1).default('api'),

    // --- http ----------------------------------------------------------
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_URL: z.string().url().default('http://localhost:3000'),
    API_INTERNAL_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    API_BODY_LIMIT: z.string().default('1mb'),
    CORS_ORIGINS: z.string().default('http://localhost:3001'),

    // --- infrastructure ------------------------------------------------
    DATABASE_URL: z
      .string({ required_error: 'DATABASE_URL is required' })
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        message: 'must be a postgresql connection string',
      }),
    DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.string({ required_error: 'REDIS_URL is required' }),
    HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),

    // --- security ------------------------------------------------------
    JWT_ACCESS_SECRET: secretSchema,
    JWT_REFRESH_SECRET: secretSchema,
    JWT_ACCESS_EXPIRES_IN: z.string().regex(durationPattern).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().regex(durationPattern).default('30d'),
    JWT_ISSUER: z.string().min(1).default('deliveryuy'),
    JWT_AUDIENCE: z.string().min(1).default('deliveryuy-clients'),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    PASSWORD_ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).max(1048576).default(65536),
    PASSWORD_ARGON2_ITERATIONS: z.coerce.number().int().min(1).max(20).default(3),
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(10),
    REQUIRE_EMAIL_VERIFICATION: booleanish(false),
    REGISTER_DEFAULT_ROLE: z.enum(['CUSTOMER']).default('CUSTOMER'),
    PASSWORD_RESET_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(2),
    /**
     * Number of reverse proxies in front of the API.
     *
     * `0` (the default) means `X-Forwarded-For` is ignored, which is the safe
     * setting: trusting the header blindly lets any client forge the address
     * that rate limits and audit records attribute a request to.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    /** Shared (redis) or per-process (memory) rate limit counters. */
    RATE_LIMIT_BACKEND: z.enum(['redis', 'memory']).default('redis'),

    // --- delivery code (ADR-010) ---------------------------------------
    DELIVERY_CODE_LENGTH: z.coerce.number().int().min(4).max(6).default(6),
    DELIVERY_CODE_NUMERIC_ONLY: booleanish(true),
    DELIVERY_CODE_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    DELIVERY_CODE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    DELIVERY_CODE_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    // --- dispatch (ADR-015) --------------------------------------------
    DISPATCH_STRATEGY: z.enum(['proximity-v1']).default('proximity-v1'),
    DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(50).default(5),
    DISPATCH_OFFER_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(45),
    DISPATCH_MAX_ROUNDS: z.coerce.number().int().min(1).max(100).default(10),
    CROSS_CITY_DISPATCH: booleanish(false),

    // --- realtime and GPS (ADR-012) -----------------------------------
    GPS_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
    GPS_POSITION_TTL_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
    GPS_HISTORY_ENABLED: booleanish(false),
    GPS_HISTORY_RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),

    // --- platform defaults ---------------------------------------------
    DEFAULT_COUNTRY: z.string().length(2).default('UY'),
    DEFAULT_CURRENCY: z.string().length(3).default('UYU'),
    DEFAULT_TIMEZONE: z.string().min(1).default('America/Montevideo'),
    RUNTIME_CONFIG_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(600).default(30),
    SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    IDEMPOTENCY_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    WEBHOOK_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(7),

    // --- providers -----------------------------------------------------
    MAP_PROVIDER: z.enum(['none', 'google', 'mapbox', 'openstreetmap']).default('none'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    MAPBOX_TOKEN: z.string().optional(),
    PAYMENT_PROVIDER: z.enum(['none', 'mercadopago', 'cash']).default('none'),
    MERCADO_PAGO_ACCESS_TOKEN: z.string().optional(),
    MERCADO_PAGO_WEBHOOK_SECRET: z.string().optional(),
    BILLING_PROVIDER: z.enum(['none', 'cfe', 'external']).default('none'),
    NOTIFICATION_PROVIDER: z.enum(['none', 'fcm', 'smtp']).default('none'),
    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./var/storage'),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_BUCKET: z.string().optional(),
    FIREBASE_PROJECT_ID: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    // --- observability (ADR-014) ---------------------------------------
    LOG_LEVEL: z
      .enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    OTEL_ENABLED: booleanish(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),

    // --- feature flags default state -----------------------------------
    FEATURE_CASH_PAYMENTS: booleanish(false),
    FEATURE_WALLET: booleanish(false),
    FEATURE_TIPS: booleanish(false),
    FEATURE_SCHEDULED_ORDERS: booleanish(false),
    FEATURE_LOYALTY: booleanish(false),
    FEATURE_MULTI_ORDER_DELIVERY: booleanish(false),
  })
  .superRefine((value, ctx) => {
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }

    const isProtectedEnv = value.APP_ENV === 'production' || value.APP_ENV === 'staging';

    if (isProtectedEnv && value.APP_ENV === 'production' && value.LOG_LEVEL === 'debug') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LOG_LEVEL'],
        message: 'must not be "debug" in production',
      });
    }

    if (isProtectedEnv && value.APP_ENV === 'production' && !value.API_URL.startsWith('https://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['API_URL'],
        message: 'must use https in production',
      });
    }

    if (isProtectedEnv && value.STORAGE_PROVIDER === 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STORAGE_PROVIDER'],
        message: 'local storage is not allowed in production; use s3',
      });
    }

    if (
      isProtectedEnv &&
      value.NOTIFICATION_PROVIDER === 'none' &&
      value.PAYMENT_PROVIDER === 'none'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'a payment provider must be configured before production launch',
      });
    }

    // Requiring verification without a delivery channel would lock every new
    // account out with no way to recover. Refused at startup instead of
    // discovered by the first customer.
    if (value.REQUIRE_EMAIL_VERIFICATION && value.NOTIFICATION_PROVIDER === 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICATION_PROVIDER'],
        message:
          'must not be "none" while REQUIRE_EMAIL_VERIFICATION is enabled: accounts would never receive the verification or recovery message',
      });
    }
  });

export type RawEnvironment = z.infer<typeof environmentSchema>;

export interface AppConfig {
  readonly env: 'development' | 'test' | 'staging' | 'production';
  readonly isProduction: boolean;
  readonly service: {
    readonly name: string;
    readonly port: number;
    readonly internalPort: number;
    readonly url: string;
    readonly bodyLimit: string;
    readonly corsOrigins: readonly string[];
  };
  readonly database: {
    readonly url: string;
    readonly poolSize: number;
  };
  readonly redis: { readonly url: string };
  readonly health: { readonly timeoutMs: number };
  readonly auth: {
    readonly accessSecret: string;
    readonly refreshSecret: string;
    readonly accessExpiresIn: string;
    readonly refreshExpiresIn: string;
    readonly issuer: string;
    readonly audience: string;
    readonly loginMaxAttempts: number;
    readonly loginLockMinutes: number;
    readonly passwordArgon2MemoryKib: number;
    readonly passwordArgon2Iterations: number;
    readonly passwordMinLength: number;
    /** Whether registration must wait for email verification before login. */
    readonly requireEmailVerification: boolean;
    /** Role given to a self-registered account. Merchant and driver apply later. */
    readonly registerDefaultRole: 'CUSTOMER';
    readonly passwordResetTtlHours: number;
    readonly trustProxyHops: number;
  };
  readonly rateLimit: {
    /**
     * `redis` shares counters across instances; `memory` keeps them per
     * process, which is only correct for a single instance.
     */
    readonly backend: 'redis' | 'memory';
  };
  readonly deliveryCode: {
    readonly length: number;
    readonly numericOnly: boolean;
    readonly ttlHours: number;
    readonly maxAttempts: number;
    readonly lockMinutes: number;
  };
  readonly dispatch: {
    readonly strategy: 'proximity-v1';
    readonly batchSize: number;
    readonly offerTtlSeconds: number;
    readonly maxRounds: number;
    readonly crossCity: boolean;
  };
  readonly gps: {
    readonly intervalSeconds: number;
    readonly positionTtlSeconds: number;
    readonly historyEnabled: boolean;
    readonly historyRetentionHours: number;
  };
  readonly defaults: {
    readonly country: string;
    readonly currency: string;
    readonly timezone: string;
  };
  readonly retention: {
    readonly runtimeConfigCacheSeconds: number;
    readonly sessionDays: number;
    readonly idempotencyDays: number;
    readonly webhookEventDays: number;
    readonly outboxDays: number;
  };
  readonly providers: {
    readonly map: {
      readonly provider: RawEnvironment['MAP_PROVIDER'];
      readonly apiKey?: string;
      readonly token?: string;
    };
    readonly payment: {
      readonly provider: RawEnvironment['PAYMENT_PROVIDER'];
      readonly accessToken?: string;
      readonly webhookSecret?: string;
    };
    readonly billing: { readonly provider: RawEnvironment['BILLING_PROVIDER'] };
    readonly notification: {
      readonly provider: RawEnvironment['NOTIFICATION_PROVIDER'];
      readonly from?: string;
    };
    readonly storage: {
      readonly provider: RawEnvironment['STORAGE_PROVIDER'];
      readonly localPath: string;
      readonly region?: string;
      readonly bucket?: string;
    };
  };
  readonly observability: {
    readonly logLevel: RawEnvironment['LOG_LEVEL'];
    readonly otelEnabled: boolean;
    readonly otelEndpoint?: string;
  };
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

function parseCsv(value: string): readonly string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Maps a validated environment into the frozen application configuration. */
export function toAppConfig(env: RawEnvironment): AppConfig {
  return Object.freeze({
    env: env.APP_ENV,
    isProduction: env.APP_ENV === 'production',
    service: Object.freeze({
      name: env.SERVICE_NAME,
      port: env.API_PORT,
      internalPort: env.API_INTERNAL_PORT,
      url: env.API_URL,
      bodyLimit: env.API_BODY_LIMIT,
      corsOrigins: Object.freeze(parseCsv(env.CORS_ORIGINS)),
    }),
    database: Object.freeze({ url: env.DATABASE_URL, poolSize: env.DATABASE_POOL_SIZE }),
    redis: Object.freeze({ url: env.REDIS_URL }),
    health: Object.freeze({ timeoutMs: env.HEALTH_CHECK_TIMEOUT_MS }),
    auth: Object.freeze({
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
      refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      loginMaxAttempts: env.LOGIN_MAX_ATTEMPTS,
      loginLockMinutes: env.LOGIN_LOCK_MINUTES,
      passwordArgon2MemoryKib: env.PASSWORD_ARGON2_MEMORY_KIB,
      passwordArgon2Iterations: env.PASSWORD_ARGON2_ITERATIONS,
      passwordMinLength: env.PASSWORD_MIN_LENGTH,
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
      registerDefaultRole: env.REGISTER_DEFAULT_ROLE,
      passwordResetTtlHours: env.PASSWORD_RESET_TTL_HOURS,
      trustProxyHops: env.TRUST_PROXY_HOPS,
    }),
    rateLimit: Object.freeze({ backend: env.RATE_LIMIT_BACKEND }),
    deliveryCode: Object.freeze({
      length: env.DELIVERY_CODE_LENGTH,
      numericOnly: env.DELIVERY_CODE_NUMERIC_ONLY,
      ttlHours: env.DELIVERY_CODE_TTL_HOURS,
      maxAttempts: env.DELIVERY_CODE_MAX_ATTEMPTS,
      lockMinutes: env.DELIVERY_CODE_LOCK_MINUTES,
    }),
    dispatch: Object.freeze({
      strategy: env.DISPATCH_STRATEGY,
      batchSize: env.DISPATCH_BATCH_SIZE,
      offerTtlSeconds: env.DISPATCH_OFFER_TTL_SECONDS,
      maxRounds: env.DISPATCH_MAX_ROUNDS,
      crossCity: env.CROSS_CITY_DISPATCH,
    }),
    gps: Object.freeze({
      intervalSeconds: env.GPS_INTERVAL_SECONDS,
      positionTtlSeconds: env.GPS_POSITION_TTL_SECONDS,
      historyEnabled: env.GPS_HISTORY_ENABLED,
      historyRetentionHours: env.GPS_HISTORY_RETENTION_HOURS,
    }),
    defaults: Object.freeze({
      country: env.DEFAULT_COUNTRY,
      currency: env.DEFAULT_CURRENCY,
      timezone: env.DEFAULT_TIMEZONE,
    }),
    retention: Object.freeze({
      runtimeConfigCacheSeconds: env.RUNTIME_CONFIG_CACHE_TTL_SECONDS,
      sessionDays: env.SESSION_RETENTION_DAYS,
      idempotencyDays: env.IDEMPOTENCY_RETENTION_DAYS,
      webhookEventDays: env.WEBHOOK_EVENT_RETENTION_DAYS,
      outboxDays: env.OUTBOX_RETENTION_DAYS,
    }),
    providers: Object.freeze({
      map: Object.freeze({
        provider: env.MAP_PROVIDER,
        apiKey: env.GOOGLE_MAPS_API_KEY,
        token: env.MAPBOX_TOKEN,
      }),
      payment: Object.freeze({
        provider: env.PAYMENT_PROVIDER,
        accessToken: env.MERCADO_PAGO_ACCESS_TOKEN,
        webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
      }),
      billing: Object.freeze({ provider: env.BILLING_PROVIDER }),
      notification: Object.freeze({ provider: env.NOTIFICATION_PROVIDER, from: env.SMTP_FROM }),
      storage: Object.freeze({
        provider: env.STORAGE_PROVIDER,
        localPath: env.STORAGE_LOCAL_PATH,
        region: env.AWS_REGION,
        bucket: env.AWS_BUCKET,
      }),
    }),
    observability: Object.freeze({
      logLevel: env.LOG_LEVEL,
      otelEnabled: env.OTEL_ENABLED,
      otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
    }),
    featureFlags: Object.freeze({
      cashPayments: env.FEATURE_CASH_PAYMENTS,
      wallet: env.FEATURE_WALLET,
      tips: env.FEATURE_TIPS,
      scheduledOrders: env.FEATURE_SCHEDULED_ORDERS,
      loyalty: env.FEATURE_LOYALTY,
      multiOrderDelivery: env.FEATURE_MULTI_ORDER_DELIVERY,
    }),
  });
}

export class ConfigurationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(`Invalid configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Validates the environment and returns frozen configuration.
 *
 * Throws `ConfigurationError` with every offending key so that operators can
 * fix the environment in one pass instead of discovering problems one restart
 * at a time.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigurationError(issues);
  }

  return toAppConfig(result.data);
}
