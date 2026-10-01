# DeliveryUY Project State

LAST_UPDATED: 2026-10-01

CURRENT_PHASE: PHASE 01
CURRENT_MODULE: Monorepo - backend foundation + application skeletons

---

## COMPLETED

### PHASE 00 - Architecture

- Product, stack, roles and order state machine defined
- ARCHITECTURE.md, DATABASE.md, SECURITY.md, LEGAL.md finalized
- docs/ERD.md, docs/SCHEMA_PROPOSAL.md, docs/MODULE_BOUNDARIES.md
- ADR-001 ... ADR-018 accepted (ADR-004 and ADR-015 carry
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

- PHASE 01 - Monorepo: only the Docker-backed verification of exit criteria 3
  and 5 is outstanding (see BLOCKED)

---

## BLOCKED

- Docker is not installed on the current development machine (no Docker, no
  WSL, no elevation), so PostgreSQL and Redis cannot be started locally.
  Consequences:
  - PHASE 01 exit criterion 3 (compose brings up both services with
    healthchecks) is unverified locally;
  - PHASE 01 exit criterion 5 second half (readiness with infrastructure) is
    unverified locally - the degraded `503` path is verified instead;
  - no `prisma migrate` has been executed yet, so PHASE 02 migrations cannot be
    validated in this environment.
  - Mitigation: the CI `integration` job runs the readiness probe against real
    service containers, so the criteria are proven where Docker exists. No
    migration may be called verified until that job is green.

---

## NEXT

1. PHASE 02 - Database: implement `docs/SCHEMA_PROPOSAL.md` as the real Prisma
   schema, with functional/partial unique indexes and CHECK constraints from raw
   SQL, then the first migration
2. Implement provider adapters behind the existing interfaces (map, payment,
   storage) instead of extending the "not configured" guards
3. PHASE 03 - Authentication: password hashing with Argon2id, access/refresh
   tokens with rotation, session revocation, RBAC guards
4. Promote the admin HTTP client to `packages/` only when a second web client
   needs it (ADR-018)
5. Seed data for development and demo environments (never in production)

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