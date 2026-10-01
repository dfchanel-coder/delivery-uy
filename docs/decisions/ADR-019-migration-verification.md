# ADR-019 - Verifying database migrations without a local database

Status: ACCEPTED

Refines ADR-016 (testing) and the migration policy in `DATABASE.md`.

## Context

PHASE 02 must deliver a Prisma schema, a migration, indexes and constraints
(`ROADMAP.MD`). Two facts shape how that work is done:

1. The development machine used so far has no PostgreSQL. Docker, WSL and
   elevation are unavailable, and a portable PostgreSQL 16.10 starts but its
   backend processes die with `0xC0000142` (`STATUS_DLL_INIT_FAILED`), so no
   session can be served (recorded in `PROJECT_STATE.md`, BLOCKED).
2. `prisma migrate diff` and `prisma validate` are pure schema-engine
   operations: they produce and check SQL without opening a connection.

So the DDL can be *authored* and *statically verified* here, but only a real
database can prove that it applies.

## Decision

- The migration is generated, never hand-typed:
  `packages/database/scripts/build-migration.mjs` runs `prisma validate`, then
  `prisma migrate diff --from-empty --to-schema-datamodel`, then appends
  `prisma/manual/0001_init_constraints.sql`. The committed
  `migrations/0001_init/migration.sql` is the concatenation of those two files,
  and rebuilding it twice produces byte-identical output.
- The hand-written SQL is a source file in its own right
  (`prisma/manual/0001_init_constraints.sql`), not an edit inside the generated
  file, so regenerating never loses a constraint and reviewing a constraint does
  not require reading a thousand generated lines.
- Conventions that the Prisma validator does not check (snake_case mapping, uuid
  keys, `timestamptz` timestamps, decimal money, no cascades towards money or
  audit history, the soft-delete catalogue) are asserted by unit tests that parse
  `schema.prisma`: `packages/database/src/schema/schema-conventions.spec.ts`.
- Applying the migration is proven by CI, not asserted locally: the
  `integration` job runs `prisma migrate deploy`, `prisma migrate status`, the
  reference-data seed twice (to prove idempotency) and then the readiness probe
  against a real PostgreSQL 16 and Redis 7.
- Seed data is split. PHASE 02 seeds reference and configuration data only.
  Users are seeded in PHASE 03, once the real password hashing exists, so no
  throwaway hash or demo credential is ever written by this repository.

## Consequences

- The committed migration is trustworthy in shape (it is machine-generated from
  the validated schema) but is **not** claimed to be applied anywhere until the
  `integration` job is green. Documentation uses that wording on purpose.
- Reviewers read two files: the schema (intent) and the manual SQL (invariants
  Prisma cannot express).
- A developer without Docker can still run `pnpm verify`, `db:validate` and
  `migration:build`; they cannot run `db:migrate`, `db:seed` or the integration
  job. That limitation is recorded instead of hidden.
- Once a migration has been applied outside a disposable database it becomes
  immutable, exactly as `AGENTS.md` section 96 requires: later phases add new
  migrations instead of rerunning this script.