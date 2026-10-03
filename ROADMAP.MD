# DeliveryUY Development Roadmap

Status legend:

```
NOT_STARTED  nothing implemented
IN_PROGRESS  partially implemented
BLOCKED      cannot proceed, reason recorded in PROJECT_STATE.md
COMPLETE     all exit criteria in docs/PHASE_00_EXIT_CRITERIA.md style passed
```

Each phase declares its own exit criteria; a phase is COMPLETE only when they
are objectively verified (compiling, lint, typecheck, tests, migrations).
See AGENTS.md section 65.

---

## PHASE 00 - Architecture

Status: COMPLETE (verified 2026-09-30)

Goals:

- define architecture
- define technology stack
- define monorepo
- define modules
- define database strategy
- define authentication model
- define order state machine
- define provider abstractions
- define security baseline

Deliverables:

- ARCHITECTURE.md (finalized)
- DATABASE.md (finalized)
- SECURITY.md (finalized)
- LEGAL.md (finalized)
- docs/ERD.md (initial ERD with constraints, indexes, retention)
- docs/SCHEMA_PROPOSAL.md (Prisma model proposal + raw SQL requirements)
- docs/MODULE_BOUNDARIES.md (layering, ownership, import rules)
- docs/decisions/ADR-001 ... ADR-016, extended later by ADR-017 ... ADR-020

Exit criteria (all met):

1. every goal above has a written decision;
2. entity model covers all roadmap entities with integrity constraints owned by
   the database;
3. money, identifiers, timestamps and soft delete conventions are fixed in ADRs;
4. security baseline covers auth, authorization, rate limits, uploads, secrets,
   websockets, redaction and security tests;
5. unresolved legal questions are enumerated, never guessed;
6. module boundaries are enforceable by lint rules defined in writing.

---

## PHASE 01 - Monorepo

Status: IN_PROGRESS - one exit criterion open, for a reason outside the code

Verified on 2026-10-02: `pnpm install`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm build:admin`, `pnpm test` (596 tests across 22 files) and
`pnpm format:check` all pass; `pnpm run flutter:check` passes (130 Dart tests,
analyzer clean in `packages/dart/core`, `apps/customer`, `apps/merchant`,
`apps/driver`). `services/api` answers the liveness probe without
infrastructure, and the admin panel (`next build`, `next start`) renders real API
state including the degraded readiness path.

Remaining exit criterion:

### Criterion 3, and the job that was missing to decide it

"The images start and become healthy" was, until this session, not closable by
anything. The workflow ran `docker compose config --quiet`, which parses a
document without starting a container, and the `integration` job took its two
servers from a `services:` block declared inside the workflow rather than from
`infrastructure/docker/docker-compose.*`. So the documented infrastructure was
never actually run, on a runner or anywhere else, and a green CI run would have
left this criterion open while looking like it had closed it.

A fourth job, `compose`, now decides it: both files are started with
`up -d --wait`, which fails unless every service reports healthy, and the
development stack then carries the whole verification script so the ports those
containers publish are exercised for real rather than assumed. Nine contracts in
`test/infrastructure/ci-workflow.spec.ts` hold it to that description, and two of
them were proven load-bearing by mutating the workflow: dropping `--wait`, and
changing the published port in the compose file, each failed exactly the contract
meant to catch it. See `docs/TESTING.MD` "What CI proves".

Still unproven, because the job has never run: no container runtime is available
on this host (not an administrator, no WSL, no Docker, no Podman) and the
repository has no remote. What changed is that pushing a branch is now sufficient
to decide it.

3. `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d`
   provides PostgreSQL and Redis with healthchecks.

**Criterion 5 is now verified** against real PostgreSQL and Redis by
`scripts/verify-infrastructure.mjs`, which boots the compiled API and reads both
probes over HTTP: `live 200`, `ready 200`, `database=up`, `redis=up`.

Criterion 3 is the only thing left, and it needs a container runtime. What is
verified without one, by `test/infrastructure/compose.spec.ts`: both files parse
as compose documents; every service pins an image and a healthcheck with retries;
no container name or host port is shared between the two stacks; the test stack
uses `tmpfs` so a run cannot inherit state; the bootstrap bind-mount source
exists on disk (a missing source silently becomes an empty directory and the
container starts healthfully having skipped its bootstrap); every interpolated
variable is documented in `.env.docker.example` and every documented variable is
used; and the PostgreSQL and Redis the dev stack publishes are the ones
`.env.example` tells the API to connect to.

That check found one real gap while being written: `TEST_POSTGRES_PORT` and
`TEST_REDIS_PORT` were interpolated with defaults but documented nowhere, so an
operator whose port was taken had a knob no file mentioned. Both are now in
`.env.docker.example`.

All other exit criteria are met, including the four application skeletons:
`apps/admin` (Next.js, HTTP client, widget-free SSR pages, 13 unit tests) and the
three Flutter applications, each with widget tests and a shared Dart contract
package (`packages/dart/core`, ADR-018).

Create:

apps/customer
apps/merchant
apps/driver
apps/admin

services/api

packages/database
packages/auth
packages/config
packages/types
packages/ui
packages/maps
packages/payments
packages/billing
packages/notifications
packages/storage

Configure:

- package manager (pnpm workspaces - ADR-007)
- TypeScript (strict, project references)
- lint (ESLint flat config with boundary rules)
- formatting (Prettier)
- shared configs
- Docker (PostgreSQL, Redis)
- environment configuration (packages/config)

Exit criteria:

1. `pnpm install` succeeds from a clean checkout;
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass;
3. `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d`
   provides PostgreSQL and Redis with healthchecks;
4. `.env.example` covers every configuration key;
5. `services/api` boots, exposes `GET /api/v1/health/live` without
   infrastructure and `GET /api/v1/health/ready` with it;
6. every workspace package has a real implementation or an explicit
   "not yet implemented" README - no empty placeholder packages;
7. no committed secrets.

---

## PHASE 02 - Database

Status: IN_PROGRESS

Implemented on 2026-10-01:

- `packages/database/prisma/schema.prisma`: 42 models and 26 enums covering every
  entity listed below, applied from `docs/SCHEMA_PROPOSAL.md` with explicit
  snake_case mapping
- migration `0001_init`: generated DDL plus the hand-written partial/functional
  unique indexes and `CHECK` constraints of DATABASE.md, reproducible through
  `packages/database/scripts/build-migration.mjs`
- convention tests that parse the schema and assert uuid keys, `timestamptz`
  timestamps, decimal money, no cascades towards money or audit history and the
  soft-delete catalogue
- `packages/database/prisma/seed.ts`: development reference data, refusing to run
  in production, plus the development accounts added in PHASE 03 (real Argon2id
  hashes, credentials from `SEED_*`)

Verified locally against a real PostgreSQL 16 server by
`scripts/verify-infrastructure.mjs` (steps 2 to 5), which is the same script the
CI `integration` job runs:

- `prisma validate`, `prisma generate`, `migration:build` (byte-identical on
  rebuild), typecheck, lint and the vitest suite
- `prisma migrate deploy` applies cleanly, and `prisma migrate status` reports
  "No pending migrations to apply"
- the seed runs twice with no duplicated row and no rewritten password hash
  (`assert-seeded-users.mjs`), and every seeded password column holds a real
  Argon2id PHC digest
- the database integration specs pass against the real server, including the
  partial functional index, the conditional `updateMany` losing a race, and
  transaction rollback after a thrown error

The PostgreSQL used locally is a native Windows build of the same major version
the compose file pins (`postgres:16-alpine`), not the image itself. Applying the
migration *inside the container* is what the CI `integration` job does and is the
one remaining unverified step for this phase.

Core entities:

User
Session
CustomerProfile
Merchant
MerchantMember
Driver
DriverDocument
Address
City
DeliveryZone
Category
Product
ProductVariant
ProductAddon
Order
OrderItem
OrderTimeline
Delivery
DriverAssignment
Payment
Refund
Commission
Settlement
AuditLog

Add:

- migrations
- indexes
- constraints
- seed

---

## PHASE 03 - Authentication

Status: IN_PROGRESS - one exit criterion outstanding (the CI `integration` job,
which has never run because this repository has no remote). Every other
criterion in AGENTS.md section 65 is met, including the frontend one that the
password recovery slice closed: every endpoint in the phase has a screen in
`apps/customer`. Everything else in the phase is implemented, documented and
verified locally or by hand against real infrastructure.

Implement:

- register
- login
- logout
- refresh
- token rotation
- password hashing
- password recovery foundation
- account status
- sessions
- RBAC

Implemented on 2026-10-02:

- `packages/auth`: Argon2id hashing (`hashPassword`, `verifyPassword`,
  `verifyPasswordOrDummy`, `passwordNeedsRehash`), the HS256 access token
  issuer/verifier on `jose`, and the principal/RBAC model - 56 unit tests.
  Dependencies and their rejection criteria: `ADR-020`
- `services/api/src/modules/auth`: ports, tokens, service, controller and DTOs,
  with five Prisma adapters (`UserRepository`, `SessionRepository`,
  `PasswordResetTokenRepository`, `RiskEventRepository`,
  `VerificationTokenRepository`). `PasswordRecoveryNotifier` refuses to pretend an
  email was sent while no provider exists, which was deferred until the
  notification delivery slice below
- refresh tokens are opaque and hashed; rotation detects replay through a
  conditional update and revokes the token family
- `JwtAuthGuard` globally, `@Public()` to opt out, `@Roles()` and
  `@Permissions()` for authorization, `@RateLimit()` per route
- rate limiting port with a Redis (Lua, atomic) backend and an in-process
  backend, failing closed when the store is unreachable
- `packages/config`: `REQUIRE_EMAIL_VERIFICATION`, `REGISTER_DEFAULT_ROLE`,
  `PASSWORD_RESET_TTL_HOURS`, `TRUST_PROXY_HOPS`, `RATE_LIMIT_BACKEND`, plus a
  `superRefine` rule that rejects verification-required without a notification
  provider
- `prisma/seed.ts` now creates the development accounts with real Argon2id
  hashes, credentials supplied by `SEED_*` variables, and the driver in
  `PENDING_REVIEW`
- 6 infrastructure specs (`*.integration.spec.ts`) for the five Prisma adapters
  and the Redis limiter, in a separate suite with a report assertion that fails
  when a test skipped (`docs/TESTING.MD`)

Closed on 2026-10-02 by the notification delivery slice and the credential
documentation:

- `packages/notifications`: a real SMTP provider. `MailTransport` is the port,
  `NodemailerMailTransport` is the only file that imports `nodemailer`, and the
  templates (Spanish and Portuguese, `es` default) live in the package rather
  than in a service. A delivery failure resolves with `accepted: false` instead
  of throwing, so a mail outage cannot block a password reset for everyone.
  Decisions: `ADR-022`
- `services/api/src/common/notifications`: the port bound to the configured
  provider, with a boot-time `verify()` that reports reachability without
  refusing to start
- `services/api/src/modules/auth`: `EmailVerificationNotifier` and
  `VerificationTokenRepository` as two further ports, `POST /api/v1/auth/verify-email`,
  and `PrismaVerificationTokenRepository`. Verification codes are opaque,
  single-use, expiring and hashed, and redeeming one is a conditional update so
  two simultaneous attempts cannot both win
- `packages/config`: `SMTP_*`, `EMAIL_VERIFICATION_TTL_HOURS` and
  `ACCOUNT_APPROVAL_REQUIRED`, with `superRefine` rules that refuse a half-set
  SMTP configuration, credentials on a non-submission port, `SMTP_REQUIRE_TLS=false`
  outside development or with credentials, and verification required with no
  delivery channel
- `readme.md`: which accounts the seed creates, that `.env.example` ships
  `CHANGE_ME` for every password on purpose, and the SMTP variables
- `packages/dart/core`: `EmailConfirmation` and `AuthApi.verifyEmail`, decoding
  both facts of the answer rather than one
- `apps/customer`: the code field on `VerificationPendingPage`, so the flow has
  a way forward instead of only a "wait". A refused code returns to that screen
  with the API's reason rather than dropping the person onto a sign-in form, and
  `{ verified: true, canSignIn: false }` says the address is confirmed and the
  account still needs approval, instead of offering a sign-in that would be
  answered `403`

Closed on 2026-10-02 by the password recovery interface, the last item the frontend
integration criterion was missing:

- `packages/dart/core`: `AuthApi.requestPasswordRecovery` and
  `completePasswordRecovery`, with `PasswordRecoveryAccepted` and
  `PasswordRecoveryResult`. The `status` literal is checked rather than stored, so
  a renamed field raises `FormatException` instead of being read as success
- `apps/customer`: `PasswordRecoveryController` and the three-step screen behind
  "¿Olvidaste tu contraseña?" on the sign-in form. Recovery is deliberately **not**
  an `AuthStatus`: the API returns no credentials after a reset, so a controller
  that treated it as a way in would describe something the API does not do. A
  refusal keeps the person on the step they started from, the token is cleared
  before the call that spends it and never restored, and no screen claims a
  message was sent - the acknowledgement proves the request arrived, not that an
  address exists or that a provider delivered anything
- `AuthFailureKind.unreachable` now covers what its own comment always claimed,
  "answered something unreadable". See PROJECT_STATE.md, defects
- `services/api`: the frozen `@MinLength(10)` is out of both password DTOs, so
  `PASSWORD_MIN_LENGTH` is again the only authority on length. See PROJECT_STATE.md,
  defects

Verified locally on 2026-10-02: `pnpm verify` exit 0 with 612 tests across 23
files, and `pnpm run flutter:check` exit 0 with 153 Dart tests (88 in
`apps/customer`). Replayed against the running API with the request bodies the new
client builds: `password/forgot` answers `202 {"data":{"status":"accepted"}}` for a
registered and an unregistered address **byte for byte**, and `password/reset`
answers `401 TOKEN_INVALID` for an unknown token - both exactly what the strict
decoders require. The join of client and server in one emulator session is still
not proven, and is not claimed.

Three real defects were found while building this, all fixed and covered:
`markEmailVerified` used one flag for two decisions, so with
`REQUIRE_EMAIL_VERIFICATION=true` a customer who proved their address stayed
pending forever and `canSignIn` was unreachable; activation ignored the account
status, so a code arriving after a suspension would have lifted it through a
public endpoint; and `NodemailerMailTransport` refused port 587 with credentials,
which is the ordinary STARTTLS submission path the configuration schema
deliberately allows.

Verified locally on 2026-10-02: `pnpm run lint`, `pnpm run build`,
`pnpm run typecheck`, `pnpm run build:admin`, `pnpm run format:check`,
`pnpm verify` exit 0, 612 vitest tests across 23 files, `pnpm run flutter:check`
exit 0 with 153 Dart tests, and 51 integration tests across 7 files with 0
skipped against real PostgreSQL and Redis. Both message flows were additionally
verified by hand against a real SMTP conversation; see `SECURITY.md` for what was
observed.

The infrastructure-dependent parts of this phase are now verified through
`scripts/verify-infrastructure.mjs`, the same script the CI `integration` job
runs: migrations apply, the seed is idempotent, all seven integration spec files
execute rather than skip, and the booted API answers both health probes.

Remaining before this phase can close:

1. the CI `integration` job green, which is the only place the Prisma adapters,
   the Redis limiter, `prisma migrate deploy` and the seed run **inside the
   compose stack** rather than against endpoints reached another way (see
   `PROJECT_STATE.md`, BLOCKED). No remote is configured on this repository, so it
   has never run.

One caveat on that job even once it runs: the Redis used locally is
`redis-memory-server`, which downloads a real Redis binary on macOS and Linux but
falls back to **Memurai** on Windows. The Lua rate limiter has therefore been
proven against a Redis-API-compatible server at a different major version, not
against `redis:7-alpine`. `docs/TESTING.MD` already requires local versions to
match the compose ones, so this is a real gap in the local evidence and not a
detail; the CI job is what closes it. Since this was written the gap stopped being
something a reader has to remember: `scripts/verify-infrastructure.mjs` asks each
server for its version and prints it beside the pin, so the run above shows
`Redis: 8.2.10 ... (compose pins redis:7-alpine)` and says it was not proven
against the reference version.

---

## PHASE 04 - Users and Roles

Implement:

CUSTOMER
MERCHANT
DRIVER
ADMIN
SUPER_ADMIN
SUPPORT
FINANCE

Add permissions and guards.

### Progress

The roles and the permission model already exist, and this phase starts by
proving them rather than by adding them:

- `packages/auth/src/rbac.ts` holds the 7 roles and the 16 `admin:*` permissions
  in a frozen matrix. `CUSTOMER`, `MERCHANT` and `DRIVER` map to an empty
  permission list, which is accurate rather than incomplete: no endpoint needs one
  yet
- `RolesGuard`, `PermissionsGuard` and `JwtAuthGuard` are registered globally, in
  that order, behind `RateLimitGuard`
- `@Roles()`, `@Permissions()`, `@Public()` and `@RateLimit()` declare what a
  route requires
- `AppRole` and the `UserRole` table exist in the schema and the seed assigns
  roles

What was missing was any evidence that the guards work. No route in the
repository carried `@Roles()` or `@Permissions()`, so the only thing that had
ever decided their behaviour was that nothing had reached them. That is the
dangerous shape of untested code: these three guards run in front of every
request in the process, and a fault in them would stay invisible until the first
protected endpoint exists - at which point it is an authorization bypass rather
than a failing test.

58 tests now cover them on their own terms, following the existing
`rate-limit.guard.spec.ts` pattern:

- `rbac.guards.spec.ts` - `@Roles()` is satisfied by **any** listed role and
  `@Permissions()` by **all** of them, which is the difference between the two
  guards and the reason the second is preferred for privileged actions. `ADMIN`
  does not pass a `SUPER_ADMIN` requirement, a role or permission name outside
  the matrix is refused for everyone including `SUPER_ADMIN` (so a typo fails
  closed), the refusal names what the route needs but never what the caller
  holds, and a missing principal is reported as a server fault rather than a
  `403` that would point the reader at the wrong problem
- `jwt-auth.guard.spec.ts` - a public route never reaches the verifier, a
  malformed header is refused without consulting it, `TOKEN_EXPIRED` is the only
  rejection a client can recover from while the other six are `TOKEN_INVALID`,
  and a fault inside the verifier becomes a `500` whose message says nothing
  about the token. That last branch had no coverage anywhere, and it matters
  most: reported as a `401`, a server fault would make every client read it as
  "your session is over", discard a valid refresh token and sign the user out
- `endpoint-security.spec.ts` - the decorators, and the finding that **none of
  them validate anything**. `@Roles('ROOT')` stores `'ROOT'` verbatim, because the
  types stop a typo at compile time and nothing stops one at runtime. That is
  recorded where the weakness lives, and it is the reason the permission guard
  has to refuse an unknown name rather than treat it as no requirement

Three of the assertions were checked by mutating the guard and confirming the
test failed: `all` relaxed to `any` in `PermissionsGuard`, the empty-list early
return removed, and the `INTERNAL_ERROR` branch disabled. The guards were then
restored byte for byte.

One real defect was found and fixed. `principalFromRequest` tested
`principal === undefined` only, so middleware that cleared the principal on
sign-out would have had `null` returned as if it were one, and the failure would
have surfaced later as a `TypeError` on `principal.roles` instead of at the one
place whose message names `JwtAuthGuard`.

Verified locally on 2026-10-03: `pnpm verify` exit 0 with 670 tests across 26
files, `pnpm run build` exit 0, and `scripts/verify-infrastructure.mjs` exit 0
with 6/6 steps, 51 integration tests across 7 files with 0 skipped against real
PostgreSQL and Redis, and `live 200, ready 200, database=up, redis=up`.

Remaining before this phase can close:

1. an endpoint that actually uses the mechanism. The 16 `admin:*` permissions
   name capabilities that no route requires yet, so today the matrix is tested
   but not exercised end to end. `AdminModule` does not exist
2. `SUPER_ADMIN`, `SUPPORT` and `FINANCE` are absent from the seed, so the matrix
   cannot be exercised against a real deployment
3. permission names for `CUSTOMER`, `MERCHANT` and `DRIVER`, once there are
   endpoints that need them

---

## PHASE 05 - Merchant

Implement:

- merchant registration
- business profile
- RUT fields
- addresses
- geographic location
- approval flow
- opening hours
- merchant users/staff
- admin review

---

## PHASE 06 - Catalog

Implement:

- categories
- products
- product images
- variants
- addons
- pricing
- stock
- availability

---

## PHASE 07 - Customer Marketplace

Implement:

- merchant listing
- location-aware listing
- merchant details
- category listing
- product search
- product details
- favorites

---

## PHASE 08 - Cart

Implement:

- cart
- cart items
- variants
- addons
- price calculation
- validation

Initial rule:

one merchant per cart.

---

## PHASE 09 - Orders

Implement:

- checkout
- order creation
- price snapshot
- address snapshot
- order state machine
- timeline
- merchant order management

---

## PHASE 10 - Driver

Implement:

- driver registration
- documentation
- vehicle
- account review
- availability
- driver profile
- suspension

---

## PHASE 11 - Dispatch

Implement:

DispatchEngine

Initial algorithm:

eligible online drivers ordered by proximity.

Include:

- offer
- timeout
- acceptance
- rejection
- reassignment

---

## PHASE 12 - GPS

Implement:

- driver location API
- WebSocket authentication
- live location events
- customer map
- merchant map where applicable
- admin map

---

## PHASE 13 - Delivery Code

Implement:

- secure delivery code
- hashed representation
- customer display
- driver validation endpoint
- rate limiting
- attempt logging
- manual exception workflow

---

## PHASE 14 - Payments

Create PaymentProvider.

Implement initially:

- cash architecture if enabled
- Mercado Pago integration foundation

Support:

- payment creation
- webhook
- idempotency
- payment state
- refunds

---

## PHASE 15 - Financial Ledger / Settlements

Implement:

- merchant gross
- commission
- merchant net
- driver earnings
- platform fees
- refunds
- adjustments
- settlement batches

---

## PHASE 16 - Billing

Create BillingProvider.

Prepare Uruguay CFE integration.

Any uncertain fiscal requirement:

LEGAL_REVIEW_REQUIRED

---

## PHASE 17 - Notifications

Implement abstraction.

Channels:

- push
- email

Prepare:

- SMS
- WhatsApp

---

## PHASE 18 - Support

Implement:

- tickets
- messages
- attachments
- categories
- disputes

---

## PHASE 19 - Admin

Implement:

- dashboard
- users
- merchants
- drivers
- orders
- payments
- refunds
- settlements
- audit
- geographic configuration
- support

---

## PHASE 20 - Security

Full security review.

Review:

- RBAC
- auth
- refresh tokens
- WebSockets
- uploads
- payments
- IDOR
- rate limits
- logs
- secrets

---

## PHASE 21 - Testing

Expand:

- unit tests
- API integration tests
- database tests
- e2e tests
- mobile critical flows

---

## PHASE 22 - Production

Prepare:

- staging
- production environment
- CI/CD
- backups
- monitoring
- alerts
- reverse proxy
- HTTPS
- deployment documentation

---

# Future Features

- scheduled deliveries
- tips
- loyalty
- wallet
- subscriptions
- advanced promotions
- multi-order driver routes
- automatic dispatch optimization
- advanced fraud detection
- merchant POS integration
- ERP integrations
- WhatsApp automation
- customer referral system