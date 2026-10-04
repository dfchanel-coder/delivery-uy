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
- the readiness probe, which reaches PostgreSQL and Redis through its own
  clients

They run against a real PostgreSQL (and Redis when the behaviour involves it)
provided by `infrastructure/docker/docker-compose.test.yml`. Mocking
`PrismaClient` for repository tests is forbidden: constraints, transactions and
numeric behaviour only exist in PostgreSQL.

#### Isolation

All integration specs share **one schema** in the database named by
`DATABASE_URL`, and truncate between tests through the shared helpers in
`services/api/src/testing/infrastructure.ts`. The suite runs with
`pool: 'forks'` and `singleFork: true`, so specs cannot interleave.

Per-file schema isolation was considered and rejected; ADR-023 records why.
Briefly: Prisma migrations apply per database rather than per schema, so
isolating each file means deploying the migration history once per file, to
obtain isolation that a single fork already guarantees. The consequence to keep
in mind is that **integration specs cannot be run in parallel** without
superseding ADR-023 first.

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

The script discovers the expected spec files from the filesystem rather than from
a hard-coded list, and compares the two sets **in both directions**. A list only
checks that what it names is present, so a spec added without registering it would
be silently unproven while the list read as coverage that does not exist.

Run the assertion by hand after a local `test:integration` to see the real state:

```bash
node scripts/assert-integration-report.mjs
```

A developer without Docker gets 3 executed and the rest skipped, and the script
exits `1` naming the specs. That is the correct outcome: the coverage is
unproven, not green.

`services/api/src/testing/infrastructure.ts` is the shared guard
(`withDatabase`, `withRedis`, `openRedis`, `truncateAuthTables`,
`hasEmailFunctionalIndex`). It returns a discriminated `Reach<T>` of `ready` or
`unavailable` rather than throwing, so a spec can skip with one branch. It uses
`return` after skipping, not `ctx.skip()` alone: in vitest 2.1.9 `ctx.skip()`
marks the test skipped but does **not** stop the body from running.

Pool note: the integration suite runs `pool: 'forks'` with `singleFork` because
`PRISMA_RESET_DATABASE`-style truncation and Redis key cleanup are not safe to
run concurrently against one database. `test/infrastructure/integration-suite.spec.ts`
asserts both the single fork and the roots the report script walks, so relaxing
either one fails a spec instead of producing flaky runs.

#### Verifying the infrastructure criteria end to end

`scripts/verify-infrastructure.mjs` is the single list of everything that needs
real infrastructure to be believed, in the order it must happen:

1. `prisma generate`
2. `prisma migrate deploy` - the DDL and the hand-written constraints apply to a
   real server
3. `prisma migrate status` - nothing is left pending
4. seed twice, asserting idempotency and real Argon2id digests
5. the integration suite, plus the skip assertion
6. boot the API and read both health probes - PHASE 01 exit criterion 5

It is what the CI `integration` job runs, so "green on CI" and "green locally"
are decided by the same code. Run it against any reachable endpoints:

```powershell
$env:DATABASE_URL = 'postgresql://delivery:delivery@localhost:5432/deliveryuy_test'
$env:REDIS_URL = 'redis://localhost:6379'
pnpm run infra:verify
```

`--from <n>` starts at a step for iteration; every earlier step is reported as
**not proved** by that run, so a partial run cannot be mistaken for a full one.

Three things this script does not settle, and which stay open until the CI job runs:

- the compose files bringing those servers up (no container runtime needed by the
  script, only reachable endpoints). This one the CI `compose` job does cover:
  it runs both files with `up --wait`, so the criterion is decided by containers
  reporting healthy rather than by a YAML parse. See "What CI proves" below;
- the health budget. Step 6 prints `HEALTH_CHECK_TIMEOUT_MS`, because the probe
  opens its own client and a host where connecting is slow needs a larger budget
  than the default. See `HEALTH_CHECK_TIMEOUT_MS` in `.env.example`. **Observed on
  this host:** with the 2000 ms default, a healthy PostgreSQL answered in
  `2187 ms` and readiness returned `503 SERVICE_UNAVAILABLE` with a message
  saying dependencies were degraded - when nothing was wrong. Re-running with
  `HEALTH_CHECK_TIMEOUT_MS=20000` gave `database=up in 2187ms, redis=up in
  20ms`. So a 503 from step 6 on a slow or loaded machine is worth reading as a
  budget problem before it is read as an outage, and the dependency timings the
  script prints are the evidence;
- the **versions**. It reports them, and warns when they differ from the pins, but
  it cannot make a local Redis 7 exist. See the version rule below.

The script prints what the API said when step 6 fails to become live. A refused
bind, an unset variable and a schema violation are all visible in the API's own
log, so a failure message that reported only "the API never answered" would be the
least useful one available.

#### Running the suite without Docker

The compose files remain the documented infrastructure, but the suite only needs
two reachable endpoints, so it can also be pointed at a local PostgreSQL and
Redis. The environment must be exported in the **calling** process:
`vitest.integration.config.ts` has no `setupFiles`, so it inherits whatever the
process already has, which is exactly what CI does through the job's `env:`.

```powershell
$env:DATABASE_URL = 'postgresql://delivery:delivery@localhost:5432/deliveryuy_test'
$env:REDIS_URL = 'redis://localhost:6379'
pnpm run test:integration
node scripts/assert-integration-report.mjs
```

Local PostgreSQL and Redis versions must match the compose ones (PostgreSQL 16,
Redis 7); a different major version can make a migration or a Lua script pass
locally and fail in CI, which is worse than not running the suite at all.

**The rule is not always satisfiable, so the tooling reports instead of assuming.**
There is no Redis 7 build for Windows without WSL or a container runtime, and
`redis-memory-server` resolves to Memurai there. Rather than leave that as
knowledge somebody has to hold, `scripts/verify-infrastructure.mjs` asks each live
server what it is - `SHOW server_version` and `INFO server` - and prints the
answer next to the image `docker-compose.test.yml` pins:

```
PostgreSQL: 16.14 at localhost:5432 (compose pins postgres:16-alpine)
Redis:      8.2.10 at redis://localhost:6379 (compose pins redis:7-alpine)
Health:     5000 per dependency
```

A mismatch is a **warning, not a failure**. Failing would assert a compatibility
claim the script cannot establish, and the suites may well pass; what it must not
do is pass without saying so. The pins are read out of the compose file rather
than repeated in the script, so the comparison cannot go on asserting a match
after a pin moves - `test/infrastructure/verify-script.spec.ts` holds that, along
with the requirement that no image reference is duplicated into the script.

**Transaction and pool timings differ from CI.** Two concurrent interactive
transactions serialise, and the wait is a fixed penalty rather than something
`poolSize` can absorb. `createDatabaseClient` therefore sets
`transactionOptions.maxWait` (`DEFAULT_TRANSACTION_MAX_WAIT_MS`, 10 s) on top of
the URL `connection_limit`: the refresh rotation and redemption paths both take
a transaction, and with the Prisma default of 2 s two simultaneous refreshes
produced `500` instead of `REFRESH_TOKEN_REUSED`. Both behaviours are pinned by
`packages/database/src/client.spec.ts` and by the integration specs.

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

`packages/dart/core` is tested against a `MockClient` rather than a server, so
the HTTP layer is exercised without a deployment: envelope decoding, the
distinction between a rejected request and an unreachable server, timeout
handling, and the fact that `Authorization` is only sent when a token is
supplied. The applications then test only what they add: the customer app
asserts that a rejected sign-in shows the API message and its correlation id,
that an unreachable server shows connectivity copy instead, that the access
token never reaches the screen, and that a second tap while a sign-in is in
flight does not open a second session (AGENTS.md section 43).

### Schema convention tests

`packages/database/src/schema/schema-conventions.spec.ts` parses
`prisma/schema.prisma` and asserts what `prisma validate` does not check: every
table and column is snake_case, primary keys are uuid, timestamps are
`timestamptz(3)`, money is `numeric(14,2)`, the soft-delete catalogue matches the
schema, and no relation cascades towards money or audit history. They need no
database, so a convention regression fails the ordinary suite instead of waiting
for the next migration.

### Repository contract tests

`test/infrastructure/` checks the files that state the project's promises but are
never executed by `pnpm test`. They run in the ordinary suite, need no
infrastructure, and read their subjects as structured data rather than as text.

| Spec | Holds |
| --- | --- |
| `compose.spec.ts` | both compose files parse; every service pins an image and a healthcheck; no container name or host port is shared between the development and test stacks; the test stack cannot inherit state; the bootstrap mount source exists; every interpolated variable is documented in `.env.docker.example` and every documented one is used; the published PostgreSQL and Redis match the `DATABASE_URL` and `REDIS_URL` in `.env.example` |
| `ci-workflow.spec.ts` | every job is bounded in time; the workflow is read-only; no step may fail quietly; every action is pinned to a released version; every `pnpm` script and every file the workflow names exists; every variable it sets is read by the configuration schema, or is allowlisted with the file that owns it; the values satisfy the real schema; the `integration` job starts real service containers with healthchecks and runs the shared verification script; no `${{ secrets.* }}` |
| `integration-suite.spec.ts` | the report script walks the same roots the integration config collects, collects only integration specs, and the suite stays on a single fork |
| `verify-script.spec.ts` | the verification script asks each live server for its version and prints it; the reference images are read out of `docker-compose.test.yml` rather than repeated in the script, and no pinned image appears inside it; a mismatch is reported as a warning and never silently passes; a failed health wait includes what the API printed; `DATABASE_URL` and `REDIS_URL` are declared required; the compose files are still admitted to be unproven |

Two of these checks exist because the corresponding failure is silent. A bind
mount whose source is missing becomes an empty directory and the container starts
healthfully having skipped its bootstrap. A port published by compose that
disagrees with the documented `DATABASE_URL` produces an API that cannot connect
to its own stack. Neither is visible until someone runs the stack.

`verify-script.spec.ts` exists for a third silent failure, the one where the tool
claims more than it proved. A verification script that prints only hostnames reads
exactly the same whether it ran against the reference versions or against whatever
the developer had installed.

**What they cannot prove.** That the images start and become healthy. That needs a
container runtime, which is why `scripts/verify-infrastructure.mjs` takes
reachable endpoints rather than running compose itself.

---

## How the suite runs

```bash
pnpm verify            # lint + typecheck + backend build + admin build + tests + format
pnpm test              # build, then vitest run (no Docker needed)
pnpm test:watch
pnpm test:coverage

pnpm run test:integration        # *.integration.spec.ts against real PostgreSQL + Redis
node scripts/assert-integration-report.mjs   # fails if anything was skipped
pnpm run infra:verify            # migrations, seed, integration suite and health probes in one run

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

`.github/workflows/ci.yml` defines four jobs:

| Job           | What it proves                                                        |
| ------------- | --------------------------------------------------------------------- |
| `verify`      | Prisma schema validation, lint, typecheck, builds, unit/API tests and formatting |
| `flutter`     | `flutter analyze` and `flutter test` in every Dart workspace           |
| `compose`     | both compose files boot and every service reports healthy, then the whole verification script runs against the development stack |
| `integration` | `prisma migrate deploy` + `migrate status`, the seed run twice with a snapshot comparison, the development-user seed check, `*.integration.spec.ts` with the skip assertion, and the readiness probe against real PostgreSQL/Redis |

The `integration` job exists because neither the readiness endpoint, a migration,
a Prisma adapter nor the Redis limiter can be proven without real dependencies;
local runs without Docker are not a substitute (ADR-019).

### What CI proves

The `compose` job is the answer to a question that was previously answered
wrongly. PHASE 01 exit criterion 3 says the images start and become healthy, and
until this job existed the workflow only ever ran `docker compose config
--quiet`, which parses a document without starting a container, while the
`integration` job took its servers from a `services:` block declared in the
workflow rather than from these files. The documented infrastructure had never
actually been run anywhere.

Two jobs rather than one, because they prove different things and both are worth
proving: `compose` runs **our** compose files, and `integration` runs the
application against service containers on the ports its `DATABASE_URL` names.

What `compose` does, in order:

1. `config --quiet` on both files, so an unparseable file fails before anything
   is created;
2. the test stack first with `up -d --wait`, because it is the smaller of the two
   and a file that cannot boot should say so in under a minute rather than after
   the whole verification;
3. the development stack with `up -d --wait`;
4. `node scripts/verify-infrastructure.mjs --from 1`, the same script a developer
   runs locally, pointed at the containers instead. This is what turns "the image
   started" into "the stack works": migrations, the seed, the integration suite
   and both health probes all travel through the published ports;
5. `down -v` for each stack under `if: always()`, so a failed verification does
   not leave containers holding ports the runner is about to be torn down with.

`--wait` is the whole of criterion 3, and it is why the timeout is 180 s: a
container that reports healthy late is still healthy, and a container that never
does should fail the step rather than be waited on indefinitely. The health
budget is separate and is raised to `HEALTH_CHECK_TIMEOUT_MS=15000` for this job,
because a runner's first connection to a container it has just started is colder
than the default 2000 ms assumes - see the observation above.

Nine contracts in `test/infrastructure/ci-workflow.spec.ts` hold this job to that
description, including that the URLs it uses name the ports the compose file
actually publishes (read out of the file rather than restated) and that every
start carries `--wait`. Two of them were proven load-bearing by mutating the
workflow: dropping `--wait`, and changing the compose file's published port,
each failed exactly the contract meant to catch it.

### The first run, and the two prerequisites it found

Run #1 (2026-10-03) is the first log this workflow has ever produced. `flutter`
passed. `verify`, `compose` and `integration` all failed, on `Lint` and on
`Build backend`.

Both failures were prerequisites satisfied by convention rather than declared,
and neither was reachable from this machine, where `dist/` and the generated
Prisma client were already present:

- **`Build backend`, in all three jobs that ran it.** The root `build` was
  `tsc -b tsconfig.json`. That compiles each project reference by invoking the
  compiler on that reference's tsconfig - it does not run the referenced
  package's `build` script, and `packages/database` generates the Prisma client
  in its own `build`. So nothing generated it, and `@prisma/client` exported
  none of the enums `packages/database/src/enums.ts` imports.
- **`Lint`, in the one job that did generate the client first.** ESLint runs with
  `projectService: true`, so the typed rules resolve types through the compiled
  project references. With no `dist/*.d.ts`, `HealthReadiness` imported by the
  admin panel had no resolvable type and `no-unsafe-member-access` fired on every
  property read from it - ten errors in one file, none mentioning the build.

ADR-024 makes each script declare what it needs: `build` and `typecheck` generate
the Prisma client, and `lint` builds first. Reproduced and fixed on this host by
deleting every `dist/` and `node_modules/.prisma` and running each script alone:
`pnpm run lint` failed with run #1's exact ten errors before the change and passes
after it. `test/infrastructure/toolchain-scripts.spec.ts` holds it as rules over
the script map, so a script added later inherits the requirement.

Neither criterion is closed by this. The `compose` job never reached its first
step, so it still has never started a container.

After the fix, on 2026-10-03: `pnpm verify` passes (685 tests across 27 files),
`pnpm run flutter:check` passes (153 Dart tests, analyzer clean in all four Dart
workspaces), and `scripts/verify-infrastructure.mjs` passes all six steps,
including 51 integration tests with 0 skipped and `live 200` / `ready 200`. The
local database is PostgreSQL 16.14, but the local Redis-compatible server is
Memurai 8.2.10, not the pinned `redis:7-alpine`. This is local evidence only: the
CI build is still pending, and the exact Redis 7 proof remains **not proven**.

The seed is verified by running it twice and comparing the second run against a
snapshot of the first (`packages/database/scripts/assert-seeded-users.mjs`). A
seed that rewrites rows it already created would be a defect, and re-running it is
the only way to see that.

## Critical rule

A successful HTTP response alone is not enough.

Verify resulting database state.
