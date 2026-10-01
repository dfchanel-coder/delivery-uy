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

---

## How the suite runs

```bash
pnpm verify            # lint + typecheck + backend build + admin build + tests + format
pnpm test              # build, then vitest run
pnpm test:watch
pnpm test:coverage

pnpm run flutter:check # flutter analyze + flutter test in every Dart workspace
pnpm run verify:all    # both gates
```

- Runner: `vitest` (ADR-016). Test files are `*.spec.ts` next to the code they
  cover (`packages/*/src`, `services/*/src`, `apps/*/src`); API integration tests
  live in `services/api/src/modules/<module>/<module>.e2e.spec.ts`.
- `services/api/src/**` is transformed by
  `test/ts-decorator-metadata-plugin.ts` instead of esbuild, because NestJS
  dependency injection needs `design:paramtypes` metadata that esbuild does not
  emit (ADR-017).
- `test/setup-env.ts` provides throwaway values for the tests that must not
  depend on a developer's `.env`.
- Throwaway secrets and `DATABASE_URL`/`REDIS_URL` used by the tests are defined
  there and in `infrastructure/docker/docker-compose.test.yml`.
- The Dart gate is a separate command because it needs the Flutter SDK
  (ADR-018). CI runs both gates as separate jobs.

## Continuous integration

`.github/workflows/ci.yml` defines three jobs:

| Job          | What it proves                                                        |
| ------------ | --------------------------------------------------------------------- |
| `verify`     | lint, typecheck, builds, unit/API tests and formatting                |
| `flutter`    | `flutter analyze` and `flutter test` in every Dart workspace           |
| `integration` | real PostgreSQL/Redis readiness probe plus compose validation         |

The `integration` job exists because the readiness endpoint can only be proven
against real dependencies; local runs without Docker are not a substitute.

## Critical rule

A successful HTTP response alone is not enough.

Verify resulting database state.