# ADR-013 - Configuration and Feature Flags

Status: ACCEPTED

## Context

AGENTS.md sections 52 and 53 require operational values (delivery code length,
GPS interval, commission defaults, maximum radius, timeouts) to be
configurable rather than hardcoded, and section 61 requires environment
variables for secrets.

## Decision

Two distinct layers, never mixed:

### Layer 1 - Bootstrap configuration (environment)

Defined once in `packages/config`, parsed with a schema validator and
**fail-fast on startup** when invalid or missing. Contains:

- infrastructure: `DATABASE_URL`, `REDIS_URL`;
- security: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, CORS origins,
  cookie settings;
- server: `API_PORT`, `API_URL`, `NODE_ENV`, `APP_ENV`;
- provider selection and credentials (`MAP_PROVIDER`, `PAYMENT_PROVIDER`,
  `STORAGE_PROVIDER`, SMTP, FCM);
- operational defaults for tunables that must exist before any database is
  reachable (for example `DELIVERY_CODE_LENGTH`, `DELIVERY_CODE_MAX_ATTEMPTS`,
  `GPS_INTERVAL_SECONDS`).

Rules:

- secrets are never defaulted to a development value in `production` or
  `staging`; startup fails if a secret is missing or equals the example
  placeholder.
- configuration objects are deep-frozen and typed; no module reads
  `process.env` directly.
- `.env.example` documents every key. `.env` is never committed.

### Layer 2 - Runtime configuration (database)

Tables `SystemConfig` (`key`, `value` JSON, `scope`, `description`,
`updatedByUserId`, `updatedAt`) and `FeatureFlag` (`key`, `enabled`,
`rolloutPercentage`, `scope`, `scopeRef`, `updatedByUserId`, `updatedAt`).

- Read through `RuntimeConfigService` with a short in-process cache
  (`RUNTIME_CONFIG_CACHE_TTL`, default 30 s) and explicit invalidation after
  an admin update.
- Every value is validated against the same zod schema shape used for layer 1
  defaults, so an invalid database value degrades to the default and raises an
  audit event instead of crashing the request.
- Every administrative change to `SystemConfig` / `FeatureFlag` writes an
  `AuditLog` entry (AGENTS.md section 93).

## Consequences

- Feature rollouts (cash payments, wallet, tips, scheduled orders, loyalty,
  multi-order delivery) can be enabled per city, merchant or user without a
  redeploy.
- Two sources of truth can drift; precedence is explicit: **database value if
  present and valid, otherwise environment default**.
- Tests can override layer 1 by environment and layer 2 by fixture rows.