# DeliveryUY Project State

LAST_UPDATED: 2026-10-02

CURRENT_PHASE: PHASE 03
CURRENT_MODULE: Authentication - Argon2id hashing, access and refresh tokens, session revocation, RBAC, rate limiting, password recovery and address verification over real SMTP, development user seed

---

## COMPLETED

### PHASE 00 - Architecture

- Product, stack, roles and order state machine defined
- ARCHITECTURE.md, DATABASE.md, SECURITY.md, LEGAL.md finalized
- docs/ERD.md, docs/SCHEMA_PROPOSAL.md, docs/MODULE_BOUNDARIES.md
- ADR-001 ... ADR-023 accepted (ADR-004 and ADR-015 carry
  `LEGAL_REVIEW_REQUIRED`; ADR-023 supersedes the isolation bullet of ADR-016)

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
  interfaces with explicit "not configured" guards instead of fake adapters.
  `notifications` is the one that now has a real implementation: PHASE 03 added
  the SMTP provider behind its port (see PHASE 03 below)
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
  memory only, `awaitingVerification` for an account the API has not enabled
  yet) and three screens - `AuthPage` (a segmented control over `SignInForm` and
  `SignUpForm`, a shared failure banner, no named routes), `SessionPage` and
  `VerificationPendingPage`. A session page action calls `GET /auth/me` with the
  access token. 21 controller tests and 13 widget tests. Cleartext HTTP is
  enabled in the **debug** manifest only, so a debug build can reach
  `http://10.0.2.2:3000`; the release manifest keeps the Android 9+ block
  - Registration never sends a role, and the password policy is not duplicated on
    the client: the interface repeats the `details.reasons` the API returns
    instead of keeping a length rule that could drift from
    `PASSWORD_MIN_LENGTH`
  - `VerificationPendingPage` states only what the API actually did, and offers
    the code field the delivery message carries, so the flow has a way forward
    instead of only a "wait". It never asserts the message arrived: delivery
    depends on the provider the deployment configures, so the copy is
    conditional ("si recibiste el mensaje"). When a deployment also requires
    approval, the answer `{ verified: true, canSignIn: false }` moves the screen
    to "Tu correo quedó verificado" with the approval stated, instead of
    offering a sign-in the API would answer `403 EMAIL_NOT_VERIFIED`
  - Session persistence (ADR-021): only the refresh token is written, through the
    `TokenStore` port in `packages/dart/core`, implemented in the application by
    `SecureTokenStore` over `flutter_secure_storage` (Android Keystore /
    iOS keychain). `restore()` runs before `runApp`, and a 15-minute access token
    no longer ends a live session: `loadAccount` retries once after renewing, and
    `ensureFreshSession` renews proactively inside a leeway. The stored record is
    namespaced by API origin so a debug build cannot replay a token issued by a
    different deployment. `apps/merchant` and `apps/driver` still hold their
    sessions in memory
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

Implemented on 2026-10-02 and **verified against real infrastructure**: the five
Prisma adapters and the Redis limiter ran in the integration suite with 0
skipped, the API was exercised over HTTP, and both delivered messages were
verified by hand against a real SMTP conversation. **Not closed**: the CI
`integration` job has never run (see BLOCKED).

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
  validated DTOs. Registration, login, logout, logout-all, refresh,
  `GET /auth/me`, password recovery and `POST /auth/verify-email`
- five Prisma adapters (`UserRepository`, `SessionRepository`,
  `PasswordResetTokenRepository`, `RiskEventRepository`,
  `VerificationTokenRepository`) plus the code delivery channel. It is bound by
  configuration: `SmtpCodeDeliveryNotifier` sends through
  `@deliveryuy/notifications`, and `UnavailableCodeDeliveryNotifier` refuses to
  claim a message was sent while no provider exists. The token is created and
  hashed either way, so turning a provider on changes delivery and nothing else
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

- new keys `REQUIRE_EMAIL_VERIFICATION`, `ACCOUNT_APPROVAL_REQUIRED`,
  `EMAIL_VERIFICATION_TTL_HOURS`, `REGISTER_DEFAULT_ROLE`,
  `PASSWORD_RESET_TTL_HOURS`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_BACKEND`, the
  `SMTP_*` notification keys, the `duration.ts` parser and a `superRefine` rule
- `REGISTER_DEFAULT_ROLE` accepts only `CUSTOMER`, and tests reject `ADMIN` and
  `MERCHANT`: self-registration cannot grant an elevated role even by
  misconfiguration
- `ACCOUNT_APPROVAL_REQUIRED` separates "prove the address" from "the account is
  usable". One flag used to mean both, which left `canSignIn` unreachable
  through HTTP: proving an address never activated the account, so the customer
  had no way out
- `SMTP_REQUIRE_TLS` (default `true`) exists so a laptop can talk to a local
  sink with no certificate. The schema refuses it outside development and
  whenever `SMTP_USER` is set, and `NodemailerMailTransport` refuses it again in
  its constructor

`packages/notifications` (ADR-022):

- a real SMTP provider. `MailTransport` is the port, `NodemailerMailTransport`
  is the only file in the workspace that imports `nodemailer`, and
  `SmtpNotificationProvider` resolves with `accepted: false` instead of
  throwing when a send fails
- templates for the verification and recovery messages in Spanish and
  Portuguese, with `es` as default and a `pt-BR` -> `pt` -> `es` fallback.
  Interpolation is strict in both directions and the HTML is always escaped
- `Message-ID` is `sha256(idempotencyKey)` where the key is
  `${templateKey}:${sha256Hex(token)}`, so a genuine re-send reuses the header
  and the token never reaches it
- `NOTIFICATION_PROVIDER` is bound as an `InjectionToken<NotificationProvider>`
  in one `notifierBinding()` inside `AuthModule`; `fcm` resolves to
  `UnconfiguredNotificationProvider` with a warning instead of silently
  resolving to something that cannot send email

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

- 6 infrastructure specs in a separate suite (`vitest.integration.config.ts`):
  the five Prisma adapters and `RedisRateLimiter`, including failing closed
- 26 tests in `packages/notifications`, 26 in `packages/config`, 5 new
  `POST /auth/verify-email` cases over HTTP, `AuthService` cases for
  `verifyEmail`/`confirmEmail`, and 7 new cases for the verification-token
  adapter, including one asserting that activation after verification leaves a
  `SUSPENDED` and a `DISABLED` account untouched while still recording the proof
- three `.env.example` drift tests, which is what makes the PHASE 01 claim that
  the example mirrors the schema true rather than aspirational: every key the
  schema reads is declared, every declared key is read by the schema or by the
  seed, and no credential-shaped value is anything but empty or the `CHANGE_ME`
  placeholder that the schema and the seed both refuse at runtime. Three keys had
  already drifted silently before the test existed; the guard was checked by
  deleting two of them and watching it fail
- `services/api/src/testing/infrastructure.ts` is the shared guard
  (`withDatabase`, `withRedis`, `Reach<T>`), returning a discriminated result
  instead of throwing so a spec can skip in one branch
- `scripts/assert-integration-report.mjs` reads the JSON report and fails when a
  test was skipped, a spec file is missing, or the executed count dropped below
  its floor. A green `test:integration` on a machine without Docker is **not**
  evidence: it reports 3 executed and 39 skipped, and the script exits 1
- `SECURITY.md` "Security Test Baseline" records which of the required security
  tests exist and which are still unverified or not applicable

Documentation updated: `ADR-020`, `ADR-022`, `SECURITY.md`, `docs/API_RULES.md`,
`docs/TESTING.MD`, `ROADMAP.MD`, `readme.md`.

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
- `apps/customer` on an Android emulator -> real sign-in and real self-registration
  against `http://10.0.2.2:3000`: `POST /auth/register` answered `201` with
  `verificationRequired: false`, roles `['CUSTOMER']` and no escalation, and the
  new account's `GET /auth/me` returned `200` with `authorization: [redacted]`.
  Logged from the device as `Dart/3.13 (dart:io)`
- `apps/customer` session persistence on the same emulator, which is the part
  unit tests cannot reach because it is a platform channel:
  - `POST /auth/login` -> `200`, then `am force-stop` and a cold start opened
    straight into "Mi sesión" with the account, after exactly one
    `POST /auth/refresh` -> `200`. The sign-in form was never rendered, and the
    new `accessTokenExpiresAt` proved the rotated token was what got persisted
  - `POST /auth/logout` -> `204`, then a cold start showed the form and issued
    **zero** requests. Had the keystore entry survived sign-out, the launch would
    have logged a `/auth/refresh` attempt

### Verified against a real SMTP conversation

Run against a local sink outside the repository (not a committed fixture), with
`NOTIFICATION_PROVIDER=smtp`, `SMTP_REQUIRE_TLS=false` and
`REQUIRE_EMAIL_VERIFICATION=true`:

- the boot-time provider `verify()` reporting the host reachable
- `POST /auth/register` -> `201`, `status: PENDING_VERIFICATION`, `tokens: null`,
  `verificationRequired: true`, and the verification message arriving as MIME with
  the right sender, subject, recipients and a `Message-ID` that is a hash rather
  than the token
- `POST /auth/login` before proving the address -> `403 EMAIL_NOT_VERIFIED`
- `POST /auth/verify-email` with the code from the message -> `200
  {"verified":true,"canSignIn":true}`, then `POST /auth/login` -> `200`, then the
  same code again -> `401 TOKEN_INVALID`
- `POST /auth/password/forgot` -> `202`, the recovery message arriving as MIME
  with its own hash and a `pr_` token, `POST /auth/password/reset` -> `200`,
  `POST /auth/login` with the new password -> `200`, and the same reset code again
  -> `401`
- no plaintext code in any log line: the notifiers log the account id and the
  provider name only, and `Message-ID` carries the digest

---

## IN_PROGRESS

- PHASE 03 - Authentication: implementation, documentation, `pnpm verify` exit 0
  (596 unit/API tests across 22 files), the Dart gate exit 0, the integration suite
  against real PostgreSQL and Redis (51 executed, 0 skipped, 7 files) and a real
  SMTP conversation for both delivered messages all pass. One item keeps the phase
  open:
  - the CI `integration` job has never run on GitHub, so the compose-based proof
    is still outstanding (see BLOCKED). No remote is configured on this
    repository.
- PHASE 02 - Database: `0001_init` applied, the seed proven idempotent and the
  database integration specs green locally, all through
  `scripts/verify-infrastructure.mjs`. The compose-based proof in CI is still
  outstanding (ADR-019).
- PHASE 01 - Monorepo: exit criterion 5 is now verified against real
  infrastructure. Only the Docker-backed verification of exit criterion 3 is
  outstanding (see BLOCKED).
- Mobile: `login`, `register`, `logout`, `verify-email` and secure session
  persistence exist end to end and are proven on the emulator (ADR-021).
  `apps/merchant` and `apps/driver` still hold their sessions in memory only, and
  neither has a screen beyond its own placeholder: the merchant and driver
  products do not exist yet, so there is nothing for persistence to serve there
- Password recovery has no screen anywhere yet. `POST /auth/password/forgot` and
  `POST /auth/password/reset` work and are proven end to end, and `AuthApi` has no
  method for them, so the customer application can neither request a reset nor
  redeem a code. PHASE 03's backend scope is complete; the interface is not

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
- `redis-memory-server` starts a Redis on `127.0.0.1:6379`. **On this Windows
  host it resolves to Memurai 8.2.0, not Redis 7.** `redis-memory-server` downloads
  a real Redis binary on macOS and Linux but falls back to Memurai on Windows, and
  Memurai is a Redis-API-compatible server rather than Redis. The Lua rate
  limiter was therefore proven against a compatible implementation at a different
  major version. `docs/TESTING.MD` already requires local versions to match the
  compose ones, so this is a genuine gap in the local evidence; the CI
  `integration` job is what closes it.

Nothing was added to the repository for this, and the compose files remain the
documented infrastructure. The only lesson worth keeping is operational: on
Windows, killing a `postmaster` with `Stop-Process` leaves its backend children
alive holding the shared memory block, and every later start fails with
`0xC0000142` (`STATUS_DLL_INIT_FAILED`). `taskkill /F /T /PID` kills the tree and
the symptom disappears. The earlier diagnosis blamed DLLs and OneDrive; it was
the orphaned children.

### Verified against that local infrastructure

All of it is now behind one command, `scripts/verify-infrastructure.mjs`, which is
also what the CI `integration` job runs. On 2026-10-02 it passed all six steps
against the local endpoints:

1. `prisma generate`;
2. `prisma migrate deploy` applies `0001_init` cleanly and
   `prisma migrate status` reports "No pending migrations to apply". This closes
   the PHASE 02 apply-migration criterion;
3. the seed runs twice: 4 users on the first run, 0 on the second, with
   `assert-seeded-users.mjs` green both times and every seeded password column
   holding a real Argon2id PHC digest;
4. the integration suite reports **51 executed, 0 skipped, 7 files**, and
   `scripts/assert-integration-report.mjs` exits 0. The five Prisma auth adapters,
   the `RedisRateLimiter` and the readiness probe are therefore proven against
   real PostgreSQL and Redis;
5. the compiled API boots and answers both probes over HTTP: `live 200`,
   `ready 200`, `database=up in 2162 ms`, `redis=up in 15 ms`. **This closes
   PHASE 01 exit criterion 5.**

The API was also exercised by hand over HTTP: `POST /auth/login` (`200`, JWT
access token, opaque `rt_…` refresh token, `expiresIn 899`, roles `['CUSTOMER']`),
`POST /auth/register`, `POST /auth/refresh` (rotated token), `GET /auth/me`, and
a wrong password returning `401` with the error envelope.

### Defects found while verifying, all fixed

- **The readiness probe could answer `500` instead of `503`.** `HealthService.readiness`
  wrapped `checkDatabaseHealth` in a second timeout. Both timers bounded the same
  work with the same message, and the loser of that race rejected instead of
  returning a verdict, so a database slower than its budget reached the client as
  an internal error. The outer wrapper is gone: `checkDatabaseHealth` bounds
  itself and returns a verdict, so the probe cannot reject. Two unit tests pin it,
  one at the service and one asserting the controller still answers
  `ServiceUnavailableException`.
- **`PROJECT_STATE.md` claimed a "real Redis".** On this host it is Memurai; see
  the unblocking note above. Corrected.
- **ADR-016 was contradicted by the code.** It promised one isolated schema per
  test file via `TEST_SCHEMA`; the implementation has always used one schema with
  truncation and a single fork. `TEST_SCHEMA` appeared nowhere in the code.
  **ADR-023** supersedes that bullet with the reasoning, and the comment in
  `docker-compose.test.yml` that repeated the claim was corrected.
- **`EXPECTED_FILES` in `assert-integration-report.mjs` had rotted.** It listed
  five spec files while seven exist, and it only checked for missing names, so
  adding a spec without registering it was silently unproven. The script now
  discovers the specs from the filesystem and compares both directions.
- **`TEST_POSTGRES_PORT` and `TEST_REDIS_PORT` were undocumented.** The test stack
  interpolated them with defaults and no example file declared them, so an
  operator whose port was taken had a knob nobody had written down. Both are now
  in `.env.docker.example`.

### Still unproven

- **Docker Compose itself.** The `integration` job remains the only place
  `docker compose` bringing up both services with healthchecks is exercised, so
  PHASE 01 exit criterion 3 stays unverified locally. Reaching equivalent
  endpoints by other means proves the code, not the compose file. What is now
  verified statically, by `test/infrastructure/compose.spec.ts`: both files parse,
  every service pins an image and a real healthcheck, no container name or host
  port is shared between the stacks, the test stack cannot inherit state, the
  bootstrap bind-mount source exists, every interpolated variable is documented
  and every documented variable is used, and the published PostgreSQL and Redis
  are the ones `.env.example` tells the API to connect to.
- **`HEALTH_CHECK_TIMEOUT_MS`.** The default of 2000 ms is not enough on this
  host: a cold Prisma connect measures about 2.16 s, so the probe spent its whole
  budget and answered `degraded` against a healthy database. The local `.env`
  raises it to 5000 ms. The default was **not** changed, because raising it
  globally would hide a real regression behind a longer wait, and a budget far
  above what a real connection costs can exceed an orchestrator's own probe
  timeout and fail regardless. The variable now documents that the budget covers
  the cold connect the probe forces, and
  `scripts/verify-infrastructure.mjs` prints it so a failed health step is
  diagnosable from the output alone.
- **Redis 7 specifically.** The Lua rate limiter has been proven against a
  Redis-API-compatible server, not against `redis:7-alpine`.

---

## NEXT

1. PHASE 03 / PHASE 01 - run the CI `integration` job so the compose files, not
   just reachable endpoints, are proven. It has never run: no remote is configured
2. Mobile - give the customer application a password recovery screen
   (`AuthApi.forgotPassword` / `resetPassword`, then a request and a redeem
   screen). The endpoints are proven; only the interface is missing
3. Mobile - give `apps/merchant` and `apps/driver` a `SecureTokenStore` over the
   existing `TokenStore` port. Deliberately deferred: both apps are placeholders,
   so the file would be written against nothing and would only look finished
4. PHASE 04 - Users and roles: per-role permissions and guards on real endpoints,
   starting from the matrix `packages/auth` already owns
5. Implement provider adapters behind the existing interfaces (map, payment,
   storage) instead of extending the "not configured" guards
6. Promote the admin HTTP client to `packages/` only when a second web client
   needs it (ADR-018)

---

## CURRENT RISKS

- Driver legal model requires professional legal review (ADR-004, LEGAL.md)
- Fiscal / CFE implementation requires accountant or fiscal provider validation
  (`LEGAL_REVIEW_REQUIRED`)
- Payment provider production credentials not configured
- Map provider not yet selected
- A deployment that leaves `NOTIFICATION_PROVIDER=none` has password recovery
  that only works by reading the database. The provider refuses to claim a
  message was sent and the token is still created and hashed, so the account is
  not locked out by accident - but nobody receives anything. The schema refuses
  this combination only when `REQUIRE_EMAIL_VERIFICATION=true`, because that is
  the case where the accounts are unusable without it
- `ACCOUNT_APPROVAL_REQUIRED=true` holds accounts in `PENDING_VERIFICATION` after
  the address is proven. A deployment that sets it without an administrative
  approval path has accounts that can never sign in, and the configuration
  cannot detect the missing screen
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