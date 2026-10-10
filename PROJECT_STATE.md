# DeliveryUY Project State

LAST_UPDATED: 2026-10-09

CURRENT_PHASE: PHASE 05
CURRENT_MODULE: PHASE 05 - Merchant, slice 1 (onboarding, business profile and admin review) is complete and its tests pass; the phase is not yet closed. Remaining slices: opening hours (`MerchantSchedule`/`MerchantClosure`), merchant staff (`MerchantMember`), and document upload. PHASE 04 is complete; see ROADMAP.MD PHASE 05 and docs/REQUIREMENTS.md for the entry point.

---

## COMPLETED

### PHASE 00 - Architecture

- Product, stack, roles and order state machine defined
- ARCHITECTURE.md, DATABASE.md, SECURITY.md, LEGAL.md finalized
- docs/ERD.md, docs/SCHEMA_PROPOSAL.md, docs/MODULE_BOUNDARIES.md
- ADR-001 ... ADR-024 accepted (ADR-004 and ADR-015 carry
  `LEGAL_REVIEW_REQUIRED`; ADR-023 supersedes the isolation bullet of ADR-016;
  ADR-024 makes the pnpm scripts declare their own prerequisites instead of
  relying on step order in CI)

### PHASE 01 - Monorepo (foundation slice)

**COMPLETE:** CI run #3 (`21aec62`, 2026-10-04) passed all seven exit criteria:
clean install, lint/typecheck/tests/build, both compose stacks healthy, API live
and readiness probes, configuration coverage, workspace implementations and no
committed secrets. The four-job workflow is green.

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
  for `*.bat`/`*.cmd`); public GitHub remote configured and CI run #3 is green

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
  yet) and four screens - `AuthPage` (a segmented control over `SignInForm` and
  `SignUpForm`, a shared failure banner, no named routes), `SessionPage`,
  `VerificationPendingPage` and `PasswordRecoveryPage`. A session page action calls
  `GET /auth/me` with the access token. Cleartext HTTP is
  enabled in the **debug** manifest only, so a debug build can reach
  `http://10.0.2.2:3000`; the release manifest keeps the Android 9+ block
  - Password recovery (closed in this slice): `PasswordRecoveryController` and
    `PasswordRecoveryPage`, reached from "Â¿Olvidaste tu contraseÃ±a?" on the
    **sign-in form only** - somebody with no account has nothing to recover, and
    on the sign-up form the link would send them after a message about an address
    that was never registered. Recovery is deliberately not an `AuthStatus`: the
    API returns no credentials after a reset, so a controller treating it as a way
    in would describe something the API does not do. The token is cleared before
    the call that spends it and never restored, the controller keeps no copy of
    it, a refusal keeps the person on the step they started from, and the
    completion screen says every session was closed instead of implying they are
    signed in
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
    to "Tu correo quedÃ³ verificado" with the approval stated, instead of
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
- `.github/workflows/ci.yml` - four jobs: `verify` (lint/typecheck/builds/tests/
  formatting), `flutter` (Dart gate), `compose` (both compose stacks boot and
  become healthy, then app verification), and `integration` (migrations, seed
  idempotency, integration specs and readiness against pinned service containers)

### PHASE 02 - Database (schema, migration, seed)

**Applied to a real PostgreSQL 16 database on 2026-10-02**: `prisma migrate
deploy` applies `0001_init` cleanly to `deliveryuy` and `deliveryuy_test`, and
`migrate status` reports the schema up to date. The seed runs twice with the
snapshot comparison green. CI run #3 also applied migrations and verified seed
idempotency against pinned PostgreSQL 16.15 / Redis 7.4.11, then passed all 51
integration tests (0 skipped). PHASE 02 is complete.

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
  the fourteen `SEED_*` credentials instead of carrying a default password
- CI `integration` job runs `prisma migrate deploy`, `prisma migrate status`,
  the seed twice (idempotency, compared through snapshots) and the integration
  suite against pinned PostgreSQL/Redis. Run #3 passed migration, seed, all
  integration tests and API readiness probes.

Locally verified: `prisma validate`, `prisma generate`, `migration:build`
reproducibility, seed build plus its production and missing-URL guards,
typecheck, lint and the vitest suite.

### PHASE 03 - Authentication

**COMPLETE:** implemented and verified locally, then CI run #3 passed all 51
integration tests against PostgreSQL 16.15 and Redis 7.4.11 (0 skipped), plus
both API health probes. The five Prisma adapters and Redis limiter ran against
the pinned services; the API was exercised over HTTP; both delivered messages
were verified by hand against a real SMTP conversation. The lost update found in
run #2 is fixed by the atomic counter update.

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
  hashes** through `@deliveryuy/auth`. All fourteen `SEED_<ROLE>_EMAIL` /
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

### PHASE 04 - Users and Roles

**COMPLETE:** CI run #9 (`2b8d515`, 2026-10-09) passed all four jobs: verify
(lint, typecheck, build, admin panel, unit/API tests, formatting), Dart, compose
(both stacks boot and the application is verified through the published ports)
and the integration job against pinned `postgres:16` + `redis:7` with no skips,
which includes the `users` Prisma adapter spec and the transaction rollback spec.

The roles and the permission model were already in place and the three global
guards were already proven in isolation (58 tests: `rbac.guards.spec.ts`,
`jwt-auth.guard.spec.ts`, `endpoint-security.spec.ts`). What was missing was a
route, which is the dangerous shape of untested code: the guards run in front of
every request, so a fault would have stayed invisible until the first protected
endpoint existed - at which point it is an authorization bypass, not a failing
test.

The first slice added that surface. `AdminModule` exposes five routes over the
tables that already exist, and each declares exactly one `@Permissions(...)` that
no route had ever required: `GET /admin/panel` and `GET /admin/feature-flags`
(`admin:panel:read`), `GET /admin/audit-logs` (`admin:audit:read`),
`GET /admin/risk-events` (`admin:risk-events:read`) and
`PATCH /admin/feature-flags/:key` (`admin:feature-flags:write`). `ADMIN` is not
unlimited: it reads the panel, flags and risk events but is refused the audit
trail and every toggle. `SUPPORT` and `FINANCE` read only the panel. Only
`SUPER_ADMIN` toggles a flag, and the toggle writes an `audit_logs` row naming
the actor, the role the token carried, both sides of the change, the IP address
and the correlation id.

Ownership follows `docs/MODULE_BOUNDARIES.md`: `AuditModule` owns `audit_logs`
and `risk_events` (reads only, plus the writer the admin command calls),
`PlatformModule` owns `feature_flags`, and `AdminModule` owns the HTTP surface
and a read model. The admin service calls the other modules' **services**, never
their repositories.

A second slice added the admin users API, which is the phase's namesake.
`services/api/src/modules/users` serves `GET /users` (paginated), `GET /users/:id`,
`PATCH /users/:id/status` and `PATCH /users/:id/roles` behind the
`USER_ADMIN_REPOSITORY` port, with `PrismaUserAdminRepository` as the production
adapter. Each route declares `admin:users:read` (ADMIN and SUPER_ADMIN) or
`admin:users:manage` (SUPER_ADMIN only), so `ADMIN` can read the directory but
cannot suspend an account or change a role. The service refuses to suspend the
last active SUPER_ADMIN, or to strip that role from it. The request DTOs use
`class-validator`, matching the global `ValidationPipe` (`whitelist` +
`forbidNonWhitelisted`). `users.e2e.spec.ts` (12 tests) drives real HTTP with the
port replaced by an in-memory double, so the suite no longer needs PostgreSQL;
the Prisma adapter keeps its coverage in the integration suite
(`prisma-user-admin.repository.integration.spec.ts`).

The phase closed on a `UnitOfWork` port (`common/database/unit-of-work.ts`)
whose Prisma adapter wraps work in one `$transaction`. `AuditService.record` and
`PlatformService.setFeatureFlagEnabled` accept an optional `TransactionContext`
and forward it to their repositories, so `AdminService.setFeatureFlagEnabled`
runs the flag update and its audit write as one atomic unit: a failure between
them rolls the update back instead of leaving a changed flag with no record.
`admin-transaction.integration.spec.ts` proves the rollback against real
PostgreSQL.

Testing: 763 unit/API tests across 36 files, plus the integration suite for the
Prisma adapters. `SUPER_ADMIN`, `SUPPORT` and `FINANCE` are seeded, which added
six `SEED_*` variables across `.env.example`, `readme.md`, the CI workflow and
`assert-seeded-users.mjs`.

Not yet done: permission names for `CUSTOMER` and `DRIVER`, which stay empty
until an endpoint needs one (AGENTS.md: an empty list is accurate, not
incomplete). `MERCHANT` is no longer empty as of PHASE 05.

---

### PHASE 05 - Merchant (slice 1: onboarding, business profile and review)

Registration, business profile, RUT fields, geographic location and the admin
review are implemented and tested. Opening hours, merchant staff and document
upload are the remaining slices and are not claimed.

**RBAC.** `packages/auth` gained `merchant:profile:read` and
`merchant:profile:manage`, both held by `MERCHANT`; `admin:merchants:review`
already existed and is held by `ADMIN`, `SUPER_ADMIN` and `SUPPORT`.
`rbac.spec.ts` was updated, so the `MERCHANT` permission list is no longer the
empty set it was in PHASE 04.

**Onboarding grants `MERCHANT` (ADR-025).** This is the one deliberate exception
to "self-registration cannot escalate". `POST /auth/register` and the
configuration refusal of `REGISTER_DEFAULT_ROLE=MERCHANT` are unchanged; the
safety argument is that the role grants only profile read/manage, the business is
created `PENDING_REVIEW`, and only an `admin:merchants:review` holder moves it to
`ACTIVE`. The role, the business, the `OWNER` membership and the
`merchant.registered` audit entry are written in one transaction.

**New modules.** `GeoModule` (`countries`, `cities`, `delivery_zones`) serves
`GET /geo/cities` and resolves a city for other modules, so no city rule is
hardcoded (AGENTS.md sections 45, 46). `MerchantsModule` owns
`merchants`/`merchant_members`/`merchant_schedules`/`merchant_closures` and
serves `POST /merchants`, `GET /merchants/mine`, `GET /merchants/:id`,
`PATCH /merchants/:id`, plus the privileged `admin/merchants` review routes in
its own `MerchantReviewController` (the `users` module precedent: a resource
module owns its admin routes). `auditActorFromRequest` was extracted to
`modules/audit` and is now shared with `AdminController`.

**Domain rules.** RUT is validated with its check digit (modulo 11, weights
`4,3,2,9,8,7,6,5,4,3,2`), stored normalized and unique, and immutable after
creation. The review state machine is explicit and central
(`PENDING_REVIEW -> ACTIVE|REJECTED`, `REJECTED -> ACTIVE`,
`ACTIVE -> SUSPENDED|DISABLED`, `SUSPENDED -> ACTIVE|DISABLED`, `DISABLED`
terminal). Coordinates are accepted as JSON numbers and stored as
`NUMERIC(9, 6)`. A non-member is answered `MERCHANT_NOT_FOUND` (404), never
`FORBIDDEN`, so an id cannot be probed.

**Testing.** 51 new unit/API tests across five files: `rut.spec.ts` (6),
`merchant-status.spec.ts` (6), `merchants.service.spec.ts` (18),
`merchant-review.controller.spec.ts` (4, the guard-metadata regression the
`admin` module has) and `merchants.e2e.spec.ts` (17, real HTTP with in-memory
doubles and signed tokens). The Prisma adapter has
`prisma-merchant.repository.integration.spec.ts` (CI-only, against a migrated
PostgreSQL), covering the real `rut_normalized` unique constraint, soft-delete
invisibility, the lossless `NUMERIC(9, 6)` round-trip and the transaction-scoped
`createWithOwner`. Full local suite: 814 tests, 0 failures; `pnpm run lint`,
`pnpm run format:check`, `pnpm run build:admin` and `pnpm run typecheck` all pass.

---

## IN_PROGRESS

- PHASE 05 - Merchant, slices 2 and 3. Opening hours (`MerchantSchedule`,
  `MerchantClosure`) and merchant staff (`MerchantMember`: invite, roles, removal)
  are not yet implemented; the tables exist from PHASE 02 and the module owns
  them. Document upload depends on `StorageProvider` (AGENTS.md section 24) and is
  deferred until that port has a production adapter
- Mobile: `login`, `register`, `logout`, `verify-email` and secure session
  persistence exist end to end and are proven on the emulator (ADR-021).
  `apps/merchant` and `apps/driver` still hold their sessions in memory only, and
  neither has a screen beyond its own placeholder: the merchant and driver
  products do not exist yet, so there is nothing for persistence to serve there
- Password recovery is now reachable in the customer application. `AuthApi` has
  `requestPasswordRecovery` / `completePasswordRecovery`, and
  `apps/customer` has the three-step flow behind a "Â¿Olvidaste tu contraseÃ±a?"
  link on the sign-in form. The token is not kept in memory by the controller,
  and no screen claims a message was sent

---

## BLOCKED

- **No blocker remains for PHASE 01â€“03.** CI run #3 passed all four jobs, including
  both compose stacks, the pinned PostgreSQL/Redis integration suite and API health
  probes. This Windows host still has no container runtime, so the compose proof is
  from GitHub Actions, not a local boot. PHASE 04 work continues under `IN_PROGRESS`.

### The container runtime, and the job that no longer needs it

Docker, Docker Desktop, WSL and Podman are all unavailable on this host, and this
session is not an administrator, so no container runtime can be installed here -
WSL needs elevation and a reboot. That is unchanged and is why the compose files
have never booted on this machine.

The gap is now closed by CI. Before the new job existed, the workflow
previously had **no job that started the compose files**: it ran
`docker compose config --quiet`, which parses a document without starting a
container, and took the `integration` job's two servers from a `services:` block
declared in the workflow rather than from these files. So PHASE 01 criterion 3
would have been reported as "pending CI" after a CI run that did not touch it.

A `compose` job runs both files with `up -d --wait`, which fails unless every
service reports healthy, and then points the whole verification script at the
development stack so the ports those containers publish are exercised for real.
Run #3 passed that job and its full verification. Nine contracts hold the workflow
to this behavior. See `docs/TESTING.MD` "What CI proves".

### The first CI run, and what it found

The remote was created and `main` pushed on 2026-10-03, so run #1 has a log.
**Three of the four jobs failed and one passed:** `flutter` (analyzer clean, 153
Dart tests) succeeded; `verify`, `compose` and `integration` did not.

Both failures were prerequisites satisfied by convention rather than declared,
and both were invisible locally for the same reason - this machine already had
`dist/` and `node_modules/.prisma` from previous runs, so a local `pnpm verify`
passed on leftover state and reported that state as a property of the repository.

1. `Build backend` failed in all three jobs that ran it. The root `build` was
   `tsc -b tsconfig.json`, which compiles each project reference by invoking the
   compiler on that reference's tsconfig and never runs the referenced package's
   `build` script. `packages/database` generates the Prisma client in its own
   `build`, so the root build never generated it, and `@prisma/client` exported
   none of the enums `packages/database/src/enums.ts` imports.
2. `Lint` failed in the one job that did generate the client first. ESLint runs
   with `projectService: true`, so the typed rules resolve types through the
   compiled project references. With no `dist/*.d.ts`, `HealthReadiness` had no
   resolvable type and `no-unsafe-member-access` fired on each property read from
   it: ten errors in `apps/admin/src/app/health/page.tsx`, none of which mention
   the missing build.

Both are fixed by ADR-024: root `build` and `typecheck` generate the Prisma
client, and `lint` builds first, so each script declares what it needs instead of
inheriting it from step order. Proven on this host by deleting every `dist/` and
`node_modules/.prisma` and running each script alone - `pnpm run lint` failed
with the run's exact ten errors before the change and passes after it. Seven
contracts in `test/infrastructure/toolchain-scripts.spec.ts` hold it.

Run #1 itself closed no criterion: its compose job failed before starting a
container. Run #2 is recorded below.

After the fix, on 2026-10-03: `pnpm verify` passes (685 tests across 27 files);
`pnpm run flutter:check` passes (153 Dart tests, analyzer clean); and
`scripts/verify-infrastructure.mjs` passes all six steps, with 51 integration
tests, 0 skipped, `live 200` and `ready 200`. The PostgreSQL server is 16.14;
the local Redis-compatible server is Memurai 8.2.10, not the pinned Redis 7, so
that run was useful local evidence, not proof against the pinned Redis version.
CI run #2 has since exercised both compose stacks and reported PostgreSQL 16.15
and Redis 7.4.11; its integration suite found the race below before health probes.

### The second CI run, and the defect it actually found

Run #2 (`67d250c`, 2026-10-04) proves the clean-checkout toolchain repair:
`Lint`, `Typecheck`, admin/backend builds, all 685 unit/API tests, formatting and
the Dart gate passed on GitHub. It also closed PHASE 01 criterion 3: both the test
compose stack and development compose stack passed `up -d --wait`. The development
stack reported PostgreSQL 16.15 and Redis 7.4.11, matching the pinned major
versions.

The two infrastructure verification jobs then failed on the same integration
test, against both the development compose services and GitHub's service
containers: `counts concurrent failures without losing increments` expected six
simultaneous failed-login attempts to persist, but only four did. Root cause:
`registerFailedLogin` read `failedLoginAttempts`, added one in application code,
and wrote the absolute value. Concurrent READ COMMITTED transactions therefore
overwrote each other's update. This was a real correctness/security defect, not a
compose failure or a flaky expectation.

Fixed locally in `PrismaUserRepository`: PostgreSQL now performs an atomic
`failedLoginAttempts + 1` under the row lock, and the same transaction reads that
updated value and makes the lockout decision before releasing the lock. The full
local infrastructure script passes after the fix (6/6 steps, 51 integration tests
across 7 files, 0 skipped, `live 200` / `ready 200`), including the focused
12-test repository spec and concurrent six-attempt assertion. Local Redis remains
Memurai 8.2.10, not Redis 7. Security behavior is documented in `SECURITY.md`.

### The third CI run: all gates green

Commit `21aec62` was pushed on 2026-10-04. Run #3 passed all four jobs:

- `Lint, typecheck, test, build`: lint, typecheck, admin/backend builds, Prisma
  validation, formatting, and 685 tests across 27 files all passed;
- `Dart analyze and tests`: 153 tests passed and all four workspaces analyzed
  without issues;
- `Compose stacks boot and become healthy`: both test and development stacks
  passed `up -d --wait`; the development stack then passed all six verification
  steps, including migration, idempotent seed, 51 integration tests (7 files, 0
  skipped), and `live 200` / `ready 200`;
- `Infrastructure smoke test`: the same six-step verification passed against
  GitHub's service containers.

Both infrastructure runs reported PostgreSQL 16.15 and Redis 7.4.11, matching
the pinned major versions. This closes PHASE 01 criteria 3 and 5, PHASE 02
migration/seed verification and PHASE 03's CI integration criterion. PHASE 01,
02 and 03 are now closed; PHASE 04 remains in progress.

### Local PostgreSQL and Redis (unblocking detail)

To unblock verification on this host, PostgreSQL 16.14 and a Redis-compatible
server were installed **outside the repository**, in the temporary scratch
directory, as development tools only:

- `embedded-postgres` starts a PostgreSQL 16 cluster on `127.0.0.1:5432`. The
  version matches the `postgres:16` image the compose files use; a different major
  version could make a migration pass locally and fail in CI.
- `redis-memory-server` starts a Redis on `127.0.0.1:6379`. **On this Windows
  host it resolves to Memurai 8.2.0, not Redis 7.** `redis-memory-server` downloads
  a real Redis binary on macOS and Linux but falls back to Memurai on Windows, and
  Memurai is a Redis-API-compatible server rather than Redis. The Lua rate
  limiter is locally exercised against a compatible implementation at a different
  major version. The exact Redis 7.4.11 proof is now supplied by CI run #3; the
  local mismatch remains an environment limitation, not a project blocker.

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
access token, opaque `rt_â€¦` refresh token, `expiresIn 899`, roles `['CUSTOMER']`),
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
- **An undecodable API response escaped every catch in the customer controller.**
  `AuthFailureKind.unreachable` is documented as covering "answered something
  unreadable", but nothing produced it: strict decoding raises a
  `FormatException`, which is not an `ApiClientException`, so it passed every
  `on ApiClientException` and tore out of `signIn`, `register`, `confirmEmail`,
  `ensureFreshSession` and `loadAccount` as an unhandled error, leaving the person
  on a spinner. Both controllers now catch it and record
  `API_RESPONSE_UNREADABLE` under the `unreachable` kind, keeping the stored
  session where nothing says the token died. Two tests cover it, one of them
  asserting the renewal keeps the session rather than signing the person out over
  a parsing problem.
- **`verify-infrastructure.mjs` printed endpoints, not versions.** It reported
  "PostgreSQL: localhost:5432" and "Redis: redis://localhost:6379", which reads
  exactly like a run against the reference versions whether or not that was true.
  The claim "real PostgreSQL and Redis" was unverifiable from its own output.
- **A failed health-probe wait discarded what the API printed.** The step reported
  "the API never answered after 30s" and nothing else. A refused bind, an unset
  variable or a schema violation are all visible in the API's own log, so the
  message was the least useful one available. The output is now included on that
  failure.
- **The first CI run exposed clean-checkout build prerequisites.** On run #1
  (2026-10-03), `Build backend` failed in all three jobs that ran it and `Lint`
  failed in the fourth. Both were latent since PHASE 01 and masked by this
  machine's build outputs. ADR-024 fixes them; seven contracts hold the fix.
- **Run #2 exposed a concurrent login-lockout lost update.** PostgreSQL stored
  four failed-login attempts from six simultaneous calls. The cause was an
  application read-modify-write of the counter under `READ COMMITTED`; fixed with
  an atomic database increment and threshold decision under the same row lock.
- **`PASSWORD_MIN_LENGTH` had a second, frozen copy in the request DTOs, and the
  copy won.** `RegisterDto` and `PasswordRecoveryCompleteDto` both declared
  `@MinLength(10)`. The validation pipe runs before the service, so the constant
  decided the outcome and `AuthService.assertPasswordPolicy` - which reads the
  configured value - was only reached above 10. Consequences: an operator lowering
  the setting changed nothing at all, and a client that renders `details.reasons`
  (which both Flutter forms already do) got class-validator's English text instead
  of the reasons, because the failing layer is the one that decides the shape.
  Found by replaying the exact request bodies the new recovery client builds
  against the running API. Both decorators are gone, length is policy rather than
  shape as the DTO file's own header says, and six e2e cases hold it on both
  endpoints - including the lowering direction, which is the one that catches the
  regression. Verified by restoring the decorators: 4 of the 6 fail.

### Not claimed / local environment limitations

- **Full customer client/server flow in one emulator session.** The APIs are
  covered over HTTP and every phase endpoint has a customer screen, but the
  complete mobile round trip in one emulator session has not been demonstrated.
  It remains explicitly not claimed and is not a PHASE 03 exit criterion.
- **Local Compose execution.** This Windows account cannot install Docker/WSL.
  The compose proof is from GitHub Actions run #3, which started both stacks and
  passed all checks; local reproduction is unavailable on this machine.
- **Local Redis version.** `redis-memory-server` resolves to Memurai 8.2.10 on
  this host, not Redis 7.4.11. CI run #3 exercised the full suite against the
  pinned Redis 7.4.11, so this is only a local parity limitation.
- **Cold local health probe budget.** A local first PostgreSQL connection took
  about 2.16 s against the 2 s default, so this host's `.env` uses 5 s. The
  default was not raised globally. CI run #3 passed readiness against both
  PostgreSQL 16.15 and Redis 7.4.11 (40â€“45 ms on the runner); the script reports
  the configured timeout so a local budget issue is distinguishable from a
  dependency failure.

---

## NEXT

1. PHASE 05 - Merchant. Slice 1 (registration, business profile, RUT, geographic
   location and admin review) is complete; `ADR-025` records the onboarding role
   grant. Continue with opening hours (`MerchantSchedule`/`MerchantClosure`) and
   merchant staff (`MerchantMember`), then document upload once
   `StorageProvider` has a production adapter. Follow the module boundaries and
   the migration process in AGENTS.md (sections 10, 25, 66, 80)
2. Mobile - give `apps/merchant` and `apps/driver` a `SecureTokenStore` over the
   existing `TokenStore` port. Deliberately deferred: both apps are placeholders,
   so the file would be written against nothing and would only look finished
3. Implement provider adapters behind the existing interfaces (map, payment,
   storage) instead of extending the "not configured" guards
4. Promote the admin HTTP client to `packages/` only when a second web client
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
- Docker unavailable in the current environment, so local compose execution is not
  possible. GitHub Actions run #3 booted both stacks and passed all checks; local
  container parity is an environment limitation, not an open project criterion.
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
