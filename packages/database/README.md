# @deliveryuy/database

Prisma client, schema and data access helpers. PostgreSQL is the source of truth
(ADR-009); the application never persists state anywhere else.

## Layout

```text
prisma/schema.prisma                      source of truth for the database
prisma/migrations/0001_init/              applied migration (generated + manual SQL)
prisma/manual/0001_init_constraints.sql   constraints Prisma cannot express
prisma/seed.ts                            reference data + development accounts
scripts/build-migration.mjs               regenerates 0001_init
scripts/assert-seeded-users.mjs           verifies the seeded accounts
src/client.ts                             PrismaClient factory and health check
src/soft-delete.ts                        soft-delete catalogue and helpers
src/schema/                               schema parser and convention tests
```

## Commands

```bash
pnpm run prisma:validate     # schema is valid (no database connection needed)
pnpm run prisma:generate     # regenerate the client after a schema change
pnpm run prisma:migrate      # create/apply a migration in development
pnpm run prisma:deploy       # apply migrations without prompts (CI, deployment)
pnpm run migration:build     # rebuild 0001_init from schema + manual SQL
pnpm run seed                # compile and run the seed (needs DATABASE_URL + SEED_*)
```

From the repository root the same tasks are `pnpm run db:validate`,
`db:generate`, `db:migrate`, `db:deploy`, `db:seed`.

`DATABASE_URL` must be present even for `validate` and `generate`: the Prisma CLI
reads it from the schema and refuses to run without it, but it opens no
connection.

## Conventions enforced here

`src/schema/schema-conventions.spec.ts` parses `schema.prisma` on every test run
and fails when the schema breaks a rule that `prisma validate` does not check:

- every table and column is snake_case (`@@map` / `@map`);
- primary keys are `uuid`;
- timestamps are `timestamptz(3)` in UTC;
- money is `numeric(14,2)`, never floating point, and every money column has an
  explicit currency companion;
- nothing cascades a delete into a payment, refund, audit log or order timeline;
- `SOFT_DELETABLE_TABLES` lists exactly the models that declare `deletedAt`.

## Migrations

Migration `0001_init` is machine-generated: `scripts/build-migration.mjs` runs
`prisma migrate diff` and appends the hand-written SQL, so rebuilding is
idempotent. Do not edit a migration that has been applied to a persistent
database; create a new one (AGENTS.md section 96). See DATABASE.md and ADR-019.

## Seeding

`prisma/seed.ts` creates reference and configuration data: country, city, two
delivery zones, platform categories, the global commission rule, the feature
flags and the operational settings. It refuses to run when `APP_ENV` or
`NODE_ENV` is `production`, and nothing is hardcoded to a single city.

It also creates one account per role family (`ADMIN`, `MERCHANT`, `DRIVER`,
`CUSTOMER`) so a login can be exercised. Two rules make those accounts real
rather than decorative:

- the passwords are hashed with the same Argon2id implementation the API uses
  (`@deliveryuy/auth`), so a seeded account is a working login;
- `SEED_<ROLE>_EMAIL` and `SEED_<ROLE>_PASSWORD` are **required**. The seed has
  no default for a credential, because an account whose password is committed to
  this repository is one an attacker can guess, and the seed would create it
  silently on any machine that forgot the variable.

`scripts/assert-seeded-users.mjs` checks the claims the seed makes: exactly one
account per family, an Argon2id digest in every `password_hash`, the expected
role, and an unchanged digest across two consecutive runs.

See DATABASE.md "Development accounts".