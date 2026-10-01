# DeliveryUY Project State

LAST_UPDATED: 2026-10-01

CURRENT_PHASE: PHASE 02
CURRENT_MODULE: Database - Prisma schema, migration 0001_init, reference seed

---

## COMPLETED

### PHASE 00 - Architecture

- Product, stack, roles and order state machine defined
- ARCHITECTURE.md, DATABASE.md, SECURITY.md, LEGAL.md finalized
- docs/ERD.md, docs/SCHEMA_PROPOSAL.md, docs/MODULE_BOUNDARIES.md
- ADR-001 ... ADR-019 accepted (ADR-004 and ADR-015 carry
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
- `packages/auth` - zero-dependency crypto primitives (opaque tokens, SHA-256,
  constant-time compare, scrypt hashing, delivery code generation) and the RBAC
  permission matrix, 15 unit tests. Password hashing arrives in PHASE 03
- `packages/database` - Prisma client factory and health check with a real
  timeout; datasource-only schema (entity models belong to PHASE 02)
- `packages/maps`, `payments`, `billing`, `notifications`, `storage` - provider
  interfaces with explicit "not configured" guards instead of fake adapters
- `packages/ui` - README explaining why it is intentionally empty for now
- `packages/dart/core` (`deliveryuy_core`) - shared Dart contracts: validated
  build configuration and the `/api/v1` envelope decoder, 15 unit tests

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
- `apps/customer`, `apps/merchant`, `apps/driver` - Flutter skeletons, each
  showing the effective API configuration and the planned scope, with three
  widget tests and stricter analyzer settings
- ESLint boundary rules forbid applications from importing `@prisma/client`,
  `@deliveryuy/database` or backend sources

Infrastructure and automation:

- `infrastructure/docker/docker-compose.dev.yml` and
  `docker-compose.test.yml` (PostgreSQL 16 + Redis 7 with healthchecks)
- `.env.example` mirrors every key of the configuration schema
- `.github/workflows/ci.yml` - three jobs: `verify` (lint/typecheck/builds/tests/
  formatting), `flutter` (Dart gate), `integration` (real PostgreSQL and Redis
  readiness probe plus compose validation)

### PHASE 02 - Database (schema, migration, seed)

Written and statically verified on 2026-10-01. **Not yet applied to a running
database** - see BLOCKED and ADR-019.

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
- `packages/database/prisma/seed.ts`: reference and configuration data only
  (country, city, two zones, platform categories, global commission rule,
  feature flags, operational settings), idempotent and refusing to run in
  production. Accounts are deferred to PHASE 03 because password hashing does
  not exist yet and a demo hash would be a fake implementation
- CI `integration` job now runs `prisma migrate deploy`, `prisma migrate status`,
  the seed twice (idempotency) and the readiness probe against real PostgreSQL
  and Redis

Locally verified: `prisma validate`, `prisma generate`, `migration:build`
reproducibility, seed build plus its production and missing-URL guards,
typecheck, lint and the vitest suite.

### Verified by running the code

- `GET /api/v1/health/live` -> `200 {"data":{"status":"ok",...}}` with no
  infrastructure running
- `GET /api/v1/health/ready` -> `503` with
  `{"error":{"code":"SERVICE_UNAVAILABLE",...,"correlationId":"..."}}` while
  PostgreSQL/Redis are unreachable
- `GET /api/v1/<unknown>` -> `404` structured `NOT_FOUND` envelope, no stack
  trace
- `apps/admin` -> `200` on `/` and `/health`, rendering the API liveness and the
  degraded readiness card with the backend correlation id

---

## IN_PROGRESS

- PHASE 02 - Database: schema, migration and seed are written; the
  infrastructure-dependent half (applying `0001_init`, running the seed and the
  database integration tests) is still unproven locally (see BLOCKED and
  ADR-019)
- PHASE 01 - Monorepo: only the Docker-backed verification of exit criteria 3
  and 5 is outstanding (see BLOCKED)

---

## BLOCKED

- PostgreSQL cannot run on the current development machine, so the
  infrastructure-dependent exit criteria cannot be verified here. What was tried
  on 2026-10-01:
  - Docker, Docker Desktop and WSL are not installed, and the shell has no
    elevation, so `docker compose` cannot be used;
  - a portable PostgreSQL 16.10 (EnterpriseDB binaries, `initdb` + `pg_ctl`,
    no elevation, no system change) installed and the postmaster started, but
    every backend process dies with `0xC0000142` (`STATUS_DLL_INIT_FAILED`) as
    soon as a client connects, so no session can be served. The extracted
    binaries and data directory were removed afterwards.
  Consequences:
  - PHASE 01 exit criterion 3 (compose brings up both services with
    healthchecks) is unverified locally;
  - PHASE 01 exit criterion 5 second half (readiness with infrastructure) is
    unverified locally - the degraded `503` path is verified by unit tests and
    by running the API;
  - PHASE 02: migration `0001_init` has never been applied, so it is written and
    statically verified (Prisma schema engine, `prisma generate`, convention
    tests) but **not** proven to apply, and the seed has never run against a real
    database. No PHASE 02 exit criterion may be called verified until the CI
    `integration` job is green.
  - Mitigation: the CI `integration` job runs `prisma migrate deploy`,
    `prisma migrate status`, the seed twice and the readiness probe against real
    PostgreSQL and Redis service containers, and validates both compose files.
    Until that job passes, PHASE 02 stays IN_PROGRESS.

---

## NEXT

1. PHASE 02 - Database: get `prisma migrate deploy` and the seed proven against a
   real PostgreSQL (CI `integration`), then close the phase
2. PHASE 03 - Authentication: password hashing with Argon2id, access/refresh
   tokens with rotation, session revocation, RBAC guards, and the development
   user seed that `prisma/seed.ts` deliberately does not create
3. Implement provider adapters behind the existing interfaces (map, payment,
   storage) instead of extending the "not configured" guards
4. Promote the admin HTTP client to `packages/` only when a second web client
   needs it (ADR-018)
5. Database integration tests (`*.e2e.spec.ts` against a real database) become
   possible only once a PostgreSQL is reachable; keep that as a CI-only layer
   meanwhile

---

## CURRENT RISKS

- Driver legal model requires professional legal review (ADR-004, LEGAL.md)
- Fiscal / CFE implementation requires accountant or fiscal provider validation
  (`LEGAL_REVIEW_REQUIRED`)
- Payment provider production credentials not configured
- Map provider not yet selected
- Docker unavailable in the current environment (see BLOCKED)
- `@nestjs/cli` pulls `@swc/core` as an optional peer; it is explicitly denied in
  `pnpm-workspace.yaml` because the project compiles with `tsc -b` (ADR-017)
- Two toolchains (pnpm and Dart) increase onboarding cost; mitigated by
  `pnpm run verify:all` and the CI jobs (ADR-018)

---

## DEVELOPMENT RULE

OpenCode must update this file whenever a phase or major module changes state.