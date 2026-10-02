# DeliveryUY Testing Strategy

## Layers

### Unit tests

Test:

- order transition rules
- pricing
- commission calculations
- delivery code validation
- permissions
- dispatch eligibility

These run without PostgreSQL or Redis. They may use in-memory test doubles for
ports (map, payment, storage, notification) but never for Prisma
(ADR-016).

### Integration tests

Test:

- database
- authentication
- orders
- payments
- delivery
- settlements

They run against a real PostgreSQL (and Redis when the behaviour involves it)
provided by `infrastructure/docker/docker-compose.test.yml`. Mocking
`PrismaClient` for repository tests is forbidden: constraints, transactions and
numeric behaviour only exist in PostgreSQL.

#### The unit/integration split

They are **two separate vitest suites**, not one suite with a filter:

| | `pnpm test` | `pnpm run test:integration` |
| --- | --- | --- |
| Config | `vitest.config.ts` | `vitest.integration.config.ts` |
| Files | `*.spec.ts` | `*.integration.spec.ts` |
| Needs | nothing | PostgreSQL + Redis |
| Exit code means | the assertions passed | the adapters behaved against real infrastructure |

`vitest.config.ts` excludes `**/*.integration.spec.ts`, so a normal `pnpm verify`
never collects them and never needs Docker.

**A green `test:integration` is not sufficient evidence.** Each spec skips
itself when a dependency is unreachable (`services/api/src/testing/infrastructure.ts`),
so "skipped" would otherwise look like "passed". Two things prevent that:

- the JSON report is always written to `integration-report.json`, and
- `scripts/assert-integration-report.mjs` fails the job if any test was skipped,
  if a spec file is missing from the report, or if fewer than
  `MIN_EXECUTED` assertions ran.

Run the assertion by hand after a local `test:integration` to see the real state:

```bash
node scripts/assert-integration-report.mjs
```

A developer without Docker gets 3 executed and 39 skipped, and the script exits
`1` naming the specs. That is the correct outcome: the coverage is unproven, not
green.

`services/api/src/testing/infrastructure.ts` is the shared guard
(`withDatabase`, `withRedis`, `openRedis`, `truncateAuthTables`,
`hasEmailFunctionalIndex`). It returns a discriminated `Reach<T>` of `ready` or
`unavailable` rather than throwing, so a spec can skip with one branch. It uses
`return` after skipping, not `ctx.skip()` alone: in vitest 2.1.9 `ctx.skip()`
marks the test skipped but does **not** stop the body from running.

Pool note: the integration suite runs `pool: 'forks'` with `singleFork` because
`PRISMA_RESET_DATABASE`-style truncation and Redis key cleanup are not safe to
run concurrently against one database.

### API tests

Test:

- successful requests
- authorization failures
- invalid input
- invalid state transitions
- duplicate requests

HTTP-level tests boot the real application through
`services/api/src/bootstrap.ts`, so production middleware, guards, pipes,
filters and interceptors are exercised. They use `supertest`; no network port is
bound.

### Security tests

Test:

- IDOR
- role escalation
- expired tokens
- invalid refresh token
- reused refresh token
- delivery code brute force
- unauthorized WebSocket access

### Flutter tests

`flutter_test` for units and widgets, `integration_test` for critical flows
(order placement, delivery code display).

Dart workspaces: `packages/dart/core` (shared contracts) and the three
applications. Widget tests assert what the user sees, including that a screen
never presents simulated data as if it were real.

### Schema convention tests

`packages/database/src/schema/schema-conventions.spec.ts` parses
`prisma/schema.prisma` and asserts what `prisma validate` does not check: every
table and column is snake_case, primary keys are uuid, timestamps are
`timestamptz(3)`, money is `numeric(14,2)`, the soft-delete catalogue matches the
schema, and no relation cascades towards money or audit history. They need no
database, so a convention regression fails the ordinary suite instead of waiting
for the next migration.

---

## How the suite runs

```bash
pnpm verify            # lint + typecheck + backend build + admin build + tests + format
pnpm test              # build, then vitest run (no Docker needed)
pnpm test:watch
pnpm test:coverage

pnpm run test:integration        # *.integration.spec.ts against real PostgreSQL + Redis
node scripts/assert-integration-report.mjs   # fails if anything was skipped

pnpm run flutter:check # flutter analyze + flutter test in every Dart workspace
pnpm run verify:all    # both gates
```

`pnpm verify` does **not** run the integration suite. That is deliberate: making
`verify` require Docker would mean a developer without it cannot check a change,
and the integration suite is the layer that CI exists to run (ADR-019).

- Runner: `vitest` (ADR-016). Test files are `*.spec.ts` next to the code they
  cover (`packages/*/src`, `services/*/src`, `apps/*/src`); API tests live in
  `services/api/src/modules/<module>/<module>.e2e.spec.ts` and infrastructure
  tests in `<module>.infrastructure/<adapter>.integration.spec.ts`.
- `services/api/src/**` is transformed by
  `test/ts-decorator-metadata-plugin.ts` instead of esbuild, because NestJS
  dependency injection needs `design:paramtypes` metadata that esbuild does not
  emit (ADR-017).
- `test/setup-env.ts` provides throwaway values for the tests that must not
  depend on a developer's `.env`.
- Throwaway secrets and `DATABASE_URL`/`REDIS_URL` used by the tests are defined
  there and in `infrastructure/docker/docker-compose.test.yml`.
- The specs compile to CommonJS, so there is no top-level `await` in them: the
  database connection is opened in `beforeAll`, not at module load.
- The Dart gate is a separate command because it needs the Flutter SDK
  (ADR-018). CI runs both gates as separate jobs.

## Continuous integration

`.github/workflows/ci.yml` defines three jobs:

| Job          | What it proves                                                        |
| ------------ | --------------------------------------------------------------------- |
| `verify`     | Prisma schema validation, lint, typecheck, builds, unit/API tests and formatting |
| `flutter`    | `flutter analyze` and `flutter test` in every Dart workspace           |
| `integration` | `prisma migrate deploy` + `migrate status`, the seed run twice with a snapshot comparison, the development-user seed check, `*.integration.spec.ts` with the skip assertion, the readiness probe against real PostgreSQL/Redis, and compose validation |

The `integration` job exists because neither the readiness endpoint, a migration,
a Prisma adapter nor the Redis limiter can be proven without real dependencies;
local runs without Docker are not a substitute (ADR-019).

The seed is verified by running it twice and comparing the second run against a
snapshot of the first (`packages/database/scripts/assert-seeded-users.mjs`). A
seed that rewrites rows it already created would be a defect, and re-running it is
the only way to see that.

## Critical rule

A successful HTTP response alone is not enough.

Verify resulting database state.