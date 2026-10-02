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

Status: IN_PROGRESS

Verified on 2026-10-01: `pnpm install`, `pnpm lint`, `pnpm typecheck`,
`pnpm build`, `pnpm build:admin`, `pnpm test` (76 tests) and `pnpm format:check`
all pass; `pnpm run flutter:check` passes (24 Dart tests, analyzer clean in
`packages/dart/core`, `apps/customer`, `apps/merchant`, `apps/driver`).
`services/api` answers the liveness probe without infrastructure, and the admin
panel (`next build`, `next start`) renders real API state including the degraded
readiness path.

Remaining exit criteria:

3. `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d`
   provides PostgreSQL and Redis with healthchecks (files written, run blocked:
   no Docker on the development machine; CI validates them with service
   containers)
5. `GET /api/v1/health/ready` with PostgreSQL and Redis running (the degraded
   `503` path is verified locally and by unit tests)

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

Verified locally: `prisma validate`, `prisma generate`, `migration:build`
(byte-identical on rebuild), typecheck, lint and the vitest suite.

Not verified locally: applying the migration, running the seed and the database
integration tests, because no PostgreSQL can run on this machine (see
`PROJECT_STATE.md`, BLOCKED). The CI `integration` job performs them; no
migration is considered applied until that job is green.

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

Status: IN_PROGRESS

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
  with four Prisma adapters (`UserRepository`, `SessionRepository`,
  `PasswordResetTokenRepository`, `RiskEventRepository`) and an
  `UnavailablePasswordRecoveryNotifier` that refuses to pretend an email was sent
  until a notification provider exists
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
- 5 infrastructure specs (`*.integration.spec.ts`) for the four Prisma adapters
  and the Redis limiter, in a separate suite with a report assertion that fails
  when a test skipped (`docs/TESTING.MD`)

Verified locally: `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`,
497 vitest tests across 17 files, `pnpm run flutter:check`.

Remaining before this phase can close:

1. the CI `integration` job green, which is the only place the four Prisma
   adapters, the Redis limiter, `prisma migrate deploy` and the seed run against
   real infrastructure (see `PROJECT_STATE.md`, BLOCKED);
2. a notification provider behind `PasswordRecoveryNotifier`. Until then,
   `POST /auth/password/forgot` accepts and records the token but no message
   leaves the process, which is why the adapter is named `Unavailable...` and
   says so instead of returning a fake success;
3. `README` / operator documentation of the bootstrap credentials the seed
   creates.

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