# DeliveryUY Project State

LAST_UPDATED: 2026-10-02

CURRENT_PHASE: PHASE 03
CURRENT_MODULE: Authentication - Argon2id hashing, access and refresh tokens, session revocation, RBAC, rate limiting, development user seed

---

## COMPLETED

### PHASE 00 - Architecture

- Product, stack, roles and order state machine defined
- ARCHITECTURE.md, DATABASE.md, SECURITY.md, LEGAL.md finalized
- docs/ERD.md, docs/SCHEMA_PROPOSAL.md, docs/MODULE_BOUNDARIES.md
- ADR-001 ... ADR-020 accepted (ADR-004 and ADR-015 carry
  `LEGAL_REVIEW_REQUIRED`)

### PHASE 01 - Monorepo (foundation slice)

Verified locally on 2026-10-01 with `pnpm verify` (lint, typecheck, backend and
admin builds, 76 TypeScript tests, formatting) and `pnpm run flutter:check`
(analyzer clean and 24 Dart tests in four Dart workspaces).

Toolchain:

- pnpm workspaces + TypeScript project references (ADR-007)
- shared configs: `packages/typescript-config`, `packages/eslint-config`
  (boundary rules from docs/MODULE_BOUNDARIES.md are enforced by lint)
- Prettier, Vitest, and a `test/tsconfig.json` project for root tooling
- pnpm dependency build scripts are allowlisted per package
  (`pnpm-workspace.yaml`); `@scarf/scarf` and `@swc/core` are explicitly denied
- `scripts/flutter-check.mjs` runs the Dart gate; `pnpm run verify:all` chains
  both gates (ADR-018)
- Git repository initialised with `.gitattributes` (LF normalisation, CRLF only
  for `*.bat`/`*.cmd`) and one bootstrap commit; nothing has been pushed

Shared packages:

- `packages/config` - zod-validated bootstrap configuration (ADR-013) with
  fail-fast behaviour, frozen output, production safety refinements and 12 unit
  tests
- `packages/types` - success/error envelopes, error code catalogue with HTTP
  mapping, realtime event contracts, health probe wire contracts
- `packages/auth` - security primitives: Argon2id hashing, the HS256 access
  token issuer/verifier (`ADR-020`, extended in PHASE 03), opaque token
  utilities, SHA-256, constant-time compare, scrypt hashing for the delivery
  code, and the RBAC permission matrix. It was dependency-free while it shipped
  scrypt and no JWT support; PHASE 03 replaced both with the documented
  algorithms and the description says so
- `packages/database` - Prisma client factory and health check with a real
  timeout; datasource-only schema (entity models belong to PHASE 02)
- `packages/maps`, `payments`, `billing`, `notifications`, `storage` - provider
  interfaces with explicit "not configured" guards instead of fake adapters
- `packages/ui` - README explaining why it is intentionally empty for now
- `packages/dart/core` (`deliveryuy_core`) - shared Dart contracts: validated
  build configuration, the `/api/v1` envelope decoder, an `ApiClient` and the
  authentication contracts (`AuthUser`, `AuthTokens`, `AuthSession`,
  `AuthRegistration`, `AuthApi`). 52 unit tests, all against a `MockClient`
  instead of a server. The client is stateless with respect to credentials: the
  access token is passed per call, because login and refresh must reach the API
  without one and a client that remembered the last token would send it to
  endpoints that should never see it

Backend:

- `services/api` - NestJS application with `createApp()` shared by production
  and integration tests, helmet, CORS allowlist, global validation pipe,
  `{ data }` response envelope, structured error filter (no stack traces to
  clients), correlation ids via `X-Request-Id`, `nestjs-pino` with a redaction
  allowlist, Swagger at `/api/docs`
- Health module: `GET /api/v1/health/live` (no infrastructure) and
  `GET /api/v1/health/ready` (real PostgreSQL + Redis round trips, `503` when a
  dependency is unreachable, clients always closed)

Applications (real, buildable, tested):

- `apps/admin` - Next.js 15 App Router panel. `/` and `/health` render live API
  state; `src/lib/api-client.ts` is an envelope-aware transport with timeout,
  typed errors and zod validation (13 unit tests); `src/lib/config.ts` validates
  `API_URL`/`API_TIMEOUT_MS`; `next build` and `next start` verified, including
  the degraded readiness card with the API correlation id
- `apps/customer` - Flutter application with the authentication slice working
  end to end against the real API: `AuthController` (session state, tokens in
  memory only), sign-in and session screens, and a "verify against the API"
  action that calls `GET /auth/me` with the access token. 12 controller tests and
  7 widget tests. Cleartext HTTP is enabled in the **debug** manifest only, so a
  debug build can reach `http://10.0.2.2:3000`; the release manifest keeps the
  Android 9+ block
- `apps/merchant`, `apps/driver` - Flutter skeletons, each showing the effective
  API configuration and the planned scope, with three widget tests and stricter
  analyzer settings
- ESLint boundary rules forbid applications from importing `@prisma/client`,
  `@deliveryuy/database` or backend sources

Infrastructure and automation:

- `infrastructure/docker/docker-compose.dev.yml` and
  `docker-compose.test.yml` (PostgreSQL 16 + Redis 7 with healthchecks)
- `.env.example` mirrors every key of the configuration schema
- `.github/workflows/ci.yml` - three jobs: `verify` (lint/typecheck/builds/tests/
  formatting), `flutter` (Dart gate), `integration` (migrations, the seed twice
  with a snapshot comparison, `*.integration.spec.ts` with the skip assertion, the
  readiness probe against real PostgreSQL and Redis, plus compose validation)

### PHASE 02 - Database (schema, migration, seed)

**Applied to a real PostgreSQL 16 database on 2026-10-02**: `prisma migrate
deploy` applies `0001_init` cleanly to `deliveryuy` and `deliveryuy_test`, and
`migrate status` reports the schema up to date. The seed runs twice with the
snapshot comparison green. The compose-based proof in CI is still outstanding.

- `packages/database/prisma/schema.prisma`: 42 models, 26 enums, applied from
  `docs/SCHEMA_PROPOSAL.md`. Every table and column is mapped explicitly to
  snake_case, primary keys are uuid, timestamps are `timestamptz(3)`, money is
  `numeric(14,2)` with an explicit currency, and coordinates carry range
  checks
- migration `0001_init`: 42 tables, 26 enum types, 90 indexes and 52 foreign
  keys, plus the invariants Prisma cannot express in
  `prisma/manual/0001_init_constraints.sql`: functional unique index on
  `lower(email)` for non-deleted users, partial unique indexes (one default
  variant per product, one `ACCEPTED` assignment per delivery, one default
  address per user, one platform category per slug) and `CHECK` constraints on
  coordinates, non-negative amounts, `quantity > 0`, opening-hour format,
  commission rate, rating range and attempt counters
- `order_timeline` uses `ON DELETE RESTRICT` towards `orders`: the timeline is
  legal history
- `packages/database/scripts/build-migration.mjs` regenerates the migration from
  the schema plus the manual SQL, and refuses to write it if the schema does not
  validate. Rebuilding twice produces byte-identical output
- `packages/database/src/schema/`: a small schema parser and convention tests
  that fail when the schema breaks a rule `prisma validate` does not check
- `packages/database/src/soft-delete.ts`: `SOFT_DELETABLE_TABLES`, `notDeleted`,
  `softDelete`, kept in sync with the schema by a test
- `packages/database/prisma/seed.ts`: reference and configuration data
  (country, city, two zones, platform categories, global commission rule,
  feature flags, operational settings) plus one account per role family, which
  arrived in PHASE 03. Idempotent, refusing to run in production, and requiring
  the eight `SEED_*` credentials instead of carrying a default password
- CI `integration` job now runs `prisma migrate deploy`, `prisma migrate status`,
  the seed twice (idempotency, compared through snapshots) and the readiness
  probe against real PostgreSQL and Redis

Locally verified: `prisma validate`, `prisma generate`, `migration:build`
reproducibility, seed build plus its production and missing-URL guards,
typecheck, lint and the vitest suite.

### PHASE 03 - Authentication

Implemented on 2026-10-02 and **verified against real infrastructure**: the four
Prisma adapters and the Redis limiter ran in the integration suite with 0
skipped, and the API was exercised over HTTP. **Not closed**: password recovery
and address verification still have no delivery channel, and the CI
`integration` job has not run (see BLOCKED and IN_PROGRESS).

`packages/auth` (ADR-020):

- Argon2id hashing through `@node-rs/argon2` with parameters from configuration.
  `hashPassword`, `verifyPassword`, `verifyPasswordOrDummy` (constant work for an
  unknown account) and `passwordNeedsRehash` (the parameters used are embedded in
  the stored hash, so raising the policy cannot invalidate existing passwords)
- HS256 access token issuer/verifier on `jose` v6, with `iss`, `aud`, `typ`,
  `sid`, `jti`, `sub` and `roles`; algorithm, issuer and audience pinned on every
  verification, and expiry reported as `expired` rather than as a generic claim
  failure
- principal and the RBAC permission matrix
- the package description no longer claims to be dependency-free; it names the
  ADRs it implements

`services/api`:

- `modules/auth`: ports, injection tokens, `AuthService`, `AuthController` and
  validated DTOs. Registration, login, logout, logout-all, refresh, `GET /auth/me`
  and password recovery
- four Prisma adapters (`UserRepository`, `SessionRepository`,
  `PasswordResetTokenRepository`, `RiskEventRepository`) plus
  `UnavailablePasswordRecoveryNotifier`, which refuses to claim an email was sent
  while no notification provider exists
- refresh tokens are opaque random values with only their SHA-256 stored; rotation
  is a conditional `updateMany` inside a transaction, so a replay loses the race,
  revokes the whole token family and raises a `RiskEvent`
- `JwtAuthGuard` registered globally, so authentication is the default and a route
  is public only with `@Public()`; `RolesGuard` and `PermissionsGuard` consume the
  matrix from `packages/auth`
- rate limiting as a port (`RateLimiter`) with a Redis backend whose `INCR` and
  `EXPIRE` are one Lua script, and an in-process backend; **fails closed** when the
  store is unreachable
- `configureApp()` is exported next to `createApp()` so the e2e specs build the
  application with providers replaced and still exercise the identical
  configuration. There is no test-only branch in production code
- `TRUST_PROXY_HOPS` configures Express `trust proxy`, so `request.ip` is the real
  client address only as many hops as the deployment declares

`packages/config`:

- new keys `REQUIRE_EMAIL_VERIFICATION`, `REGISTER_DEFAULT_ROLE`,
  `PASSWORD_RESET_TTL_HOURS`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_BACKEND`, the
  `duration.ts` parser and a `superRefine` rule
- `REGISTER_DEFAULT_ROLE` accepts only `CUSTOMER`, and tests reject `ADMIN` and
  `MERCHANT`: self-registration cannot grant an elevated role even by
  misconfiguration

Development seed:

- `prisma/seed.ts` now creates the development accounts with **real Argon2id
  hashes** through `@deliveryuy/auth`. All eight `SEED_<ROLE>_EMAIL` /
  `SEED_<ROLE>_PASSWORD` variables are **required** with no committed default,
  because an account created with a password that lives in this repository is one
  an attacker can guess and the seed would create it silently on any machine that
  forgot the variable. `.env.example` documents them and CI declares them
- accounts are `ACTIVE` with `emailVerifiedAt` set; the driver is created
  separately because its `Driver` row requires a `cityId`, and starts in
  `PENDING_REVIEW`
- `packages/database/scripts/assert-seeded-users.mjs` compares two consecutive
  seed runs, so a seed that rewrote an existing hash fails CI

Testing:

- 5 infrastructure specs in a separate suite (`vitest.integration.config.ts`):
  the four Prisma adapters and `RedisRateLimiter`, including failing closed
- `services/api/src/testing/infrastructure.ts` is the shared guard
  (`withDatabase`, `withRedis`, `Reach<T>`), returning a discriminated result
  instead of throwing so a spec can skip in one branch
- `scripts/assert-integration-report.mjs` reads the JSON report and fails when a
  test was skipped, a spec file is missing, or the executed count dropped below
  its floor. A green `test:integration` on a machine without Docker is **not**
  evidence: it reports 3 executed and 39 skipped, and the script exits 1
- `SECURITY.md` "Security Test Baseline" records which of the required security
  tests exist and which are still unverified or not applicable

Documentation updated: `ADR-020`, `SECURITY.md`, `docs/API_RULES.md`,
`docs/TESTING.MD`, `ROADMAP.MD`.

### Verified by running the code

- `GET /api/v1/health/live` -> `200 {"data":{"status":"ok",...}}` with no
  infrastructure running
- `GET /api/v1/health/ready` -> `503` with
  `{"error":{"code":"SERVICE_UNAVAILABLE",...,"correlationId":"..."}}` while
  PostgreSQL/Redis are unreachable, and `200 {"status":"ready",...}` with both
  reporting `up` and their latencies while they are running
- `GET /api/v1/<unknown>` -> `404` structured `NOT_FOUND` envelope, no stack
  trace
- `apps/admin` -> `200` on `/` and `/health`, rendering the API liveness and the
  degraded readiness card with the backend correlation id
- `apps/customer` on an Android emulator -> real sign-in against
  `http://10.0.2.2:3000`, showing the account the API returned; `GET /auth/me`
  with the issued token succeeds from the device

---

## IN_PROGRESS

- PHASE 03 - Authentication: implementation, documentation, lint, typecheck,
  505 unit/API tests, the Dart gate and the integration suite against real
  infrastructure all pass. What keeps the phase open:
  - `PasswordRecoveryNotifier` still has no real delivery channel. The adapter is
    named `Unavailable...` and refuses to pretend an email was sent, which is the
    correct shape but not the finished feature. Address verification depends on
    the same channel;
  - the CI `integration` job has never run on GitHub, so the compose-based proof
    is still outstanding (see BLOCKED).
- PHASE 02 - Database: `0001_init` applied, the seed proven idempotent and the
  database integration specs green locally. The compose-based proof in CI is
  still outstanding (ADR-019).
- PHASE 01 - Monorepo: only the Docker-backed verification of exit criterion 3 is
  outstanding (see BLOCKED).
- Mobile: only `login` and `logout` exist end to end. Tokens are held in memory,
  so a restart loses the session; there is no secure storage and no refresh on
  expiry yet. `AuthApi.register` exists in the shared package but the customer
  application has no registration screen yet.

---

## BLOCKED

- **Nothing is blocked for the current scope.** PostgreSQL and Redis now run
  locally, so the infrastructure-dependent criteria were verified here instead of
  waiting for CI. What changed, and what is still not proven:

### Local PostgreSQL and Redis (unblocking detail)

Docker, Docker Desktop and WSL are still unavailable, and the documented
infrastructure is still `infrastructure/docker/docker-compose.*`. To unblock
verification on this host, PostgreSQL 16.14 and Redis 7 were installed **outside
the repository**, in the temporary scratch directory, as development tools only:

- `embedded-postgres` starts a PostgreSQL 16 cluster on `127.0.0.1:5432`. The
  version matches the `postgres:16` image the compose files use; a different major
  version could make a migration pass locally and fail in CI.
- `redis-memory-server` starts a real Redis on `127.0.0.1:6379`.

Nothing was added to the repository for this, and the compose files remain the
documented infrastructure. The only lesson worth keeping is operational: on
Windows, killing a `postmaster` with `Stop-Process` leaves its backend children
alive holding the shared memory block, and every later start fails with
`0xC0000142` (`STATUS_DLL_INIT_FAILED`). `taskkill /F /T /PID` kills the tree and
the symptom disappears. The earlier diagnosis blamed DLLs and OneDrive; it was
the orphaned children.

### Verified against that local infrastructure

- `prisma migrate deploy` applies `0001_init` cleanly to both `deliveryuy` and
  `deliveryuy_test`, and `prisma migrate status` reports the schema up to date.
  This closes the PHASE 02 apply-migration criterion.
- The seed runs twice: 4 users on the first run, 0 on the second, with
  `assert-seeded-users.mjs` green both times.
- The integration suite reports **42 executed, 0 skipped, 5 files**, and
  `scripts/assert-integration-report.mjs` exits 0. The four Prisma auth adapters
  and the `RedisRateLimiter` are therefore proven against real PostgreSQL and
  real Redis.
- The API was run and exercised over HTTP: `/health/live`, `/health/ready`
  (`200`, `database` and `redis` up), `POST /auth/login` (`200`, JWT access
  token, opaque `rt_…` refresh token, `expiresIn 899`, roles `['CUSTOMER']`),
  `POST /auth/register`, `POST /auth/refresh` (rotated token), `GET /auth/me`,
  and a wrong password returning `401` with the error envelope.

### Still unproven

- **Docker Compose itself.** The `integration` job remains the only place
  `docker compose` bringing up both services with healthchecks is exercised, so
  PHASE 01 exit criterion 3 stays unverified locally. Reaching equivalent
  endpoints by other means proves the code, not the compose file.
- **`HEALTH_CHECK_TIMEOUT_MS`.** The default of 2000 ms has almost no margin on
  this host: a cold Prisma connection takes about 2.3 s, so the readiness probe
  consumed its entire budget. The local `.env` raises it to 5000 ms. The default
  was **not** changed, because raising it globally would hide a real regression
  behind a longer wait; this is a note for whoever tunes it per deployment.

---

## NEXT

1. Mobile - secure storage for the token pair, plus a refresh on expiry, so a
   restart does not lose the session and a 15-minute access token does not end a
   session mid-order
2. Mobile - registration screen on top of the existing `AuthApi.register`, and the
   pending-verification path the shared package already models
3. PHASE 03 - implement a notification provider behind
   `PasswordRecoveryNotifier` so password recovery and address verification can
   actually deliver a message, and document the seeded bootstrap credentials
4. PHASE 03 / PHASE 01 - run the CI `integration` job so the compose files, not
   just reachable endpoints, are proven
5. PHASE 04 - Users and roles: per-role permissions and guards on real endpoints,
   starting from the matrix `packages/auth` already owns
6. Implement provider adapters behind the existing interfaces (map, payment,
   storage) instead of extending the "not configured" guards
7. Promote the admin HTTP client to `packages/` only when a second web client
   needs it (ADR-018)

---

## CURRENT RISKS

- Driver legal model requires professional legal review (ADR-004, LEGAL.md)
- Fiscal / CFE implementation requires accountant or fiscal provider validation
  (`LEGAL_REVIEW_REQUIRED`)
- Payment provider production credentials not configured
- Map provider not yet selected
- Password recovery and address verification have no delivery channel yet
  (`UnavailablePasswordRecoveryNotifier`); the token is generated, stored and
  single-use, but nothing sends it. A deployment that leaves it there has
  password recovery that only works by reading the database
- Docker unavailable in the current environment. PostgreSQL and Redis were run
  locally outside the repository to unblock verification, which proves the code
  but not the compose files (see BLOCKED)
- `@nestjs/cli` pulls `@swc/core` as an optional peer; it is explicitly denied in
  `pnpm-workspace.yaml` because the project compiles with `tsc -b` (ADR-017)
- `@node-rs/argon2` needs a prebuilt binary for the target platform. None is
  needed on the CI or development platforms, and the package ships no install
  script, so it needed no entry in the deny-by-default `allowBuilds` list
  (`ADR-020`)
- Two toolchains (pnpm and Dart) increase onboarding cost; mitigated by
  `pnpm run verify:all` and the CI jobs (ADR-018)

---

## DEVELOPMENT RULE

OpenCode must update this file whenever a phase or major module changes state.