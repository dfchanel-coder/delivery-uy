# ADR-024 - Declared Prerequisites Over Consequential Ordering

Status: ACCEPTED

## Context

The first CI run this repository ever had failed in three of its four jobs. Two
distinct defects, and both invisible locally for the same reason.

**`Build backend` failed in every job that ran it.** The root `build` script was
`tsc -b tsconfig.json`. That compiles each project reference by invoking the
TypeScript compiler on the reference's own tsconfig; it does **not** run the
referenced package's `build` script. `packages/database` generates the Prisma
client in its own `build` (`pnpm run prisma:generate && tsc -b`), so the root
build never generated it. On a runner that had only run `pnpm install`,
`@prisma/client` exports none of the generated enums and the compile fails with
`Module '"@prisma/client"' has no exported member 'AppRole'`. The message names
the wrong culprit: the schema and the imports are both correct.

**`Lint` failed in the one job that did generate the client first.** ESLint runs
with `projectService: true` (ADR-007), so every rule that reasons about a type
resolves it through the project references. With no `dist/*.d.ts` present,
`HealthReadiness` as imported by `apps/admin/src/app/health/page.tsx` has no
resolvable type, and `no-unsafe-member-access` fires on each property read from
it - ten errors in one file, none of which mention the missing build.

Both were masked locally because the machine the work happened on already had
`dist/` and `node_modules/.prisma` from previous runs. A local `pnpm verify`
passed because of leftover state and reported that state as a property of the
repository. This is the general failure mode AGENTS.md section 65 is written
against: a gate that cannot fail has stopped being a gate.

The two defects are the same class of mistake. Each is a prerequisite that was
satisfied by convention - by step order in a YAML file, by having run the build
somewhere else first - rather than declared by the thing that needs it. The
question this ADR settles is where such a prerequisite belongs.

## Decision

**A script declares its own prerequisites. Step order in CI is not a mechanism.**

- Root `build` runs `pnpm run db:generate` before `tsc -b tsconfig.json`.
- Root `typecheck` does the same, since `--force` always recompiles
  `packages/database`.
- Root `lint` runs `pnpm run build` first, because the typed rules resolve their
  types through the compiled project references.
- `test/infrastructure/toolchain-scripts.spec.ts` holds each of these, as rules
  over the script map rather than as three restated strings, so a script added
  later inherits the requirement instead of rediscovering it.

### Why the script and not the workflow

A YAML step order is invisible from the code that depends on it. The defect
survived because the person who wrote `build` had no way to learn that
`packages/database` generated the client in a script nobody calls; and the person
who wrote the workflow had no way to learn that three of its four jobs needed a
step the fourth had. Encoding the prerequisite in the script makes the dependency
readable at the point of use, makes it hold for `pnpm lint` typed by hand as well
as for CI, and removes the ordering as a thing that can be got wrong.

### Why `lint` builds, rather than type-aware linting being turned down

The alternative is to give up type information (`recommended` instead of
`recommendedTypeChecked`, or `projectService: false`), which would make the gate
pass on a broken tree. The cost of the chosen option is that `pnpm lint` on a
cold tree takes a full compile first. `tsc -b` is incremental, so a warm tree
pays about a second. Paying that to keep ten real errors out of the report is the
better trade.

### Why not a `postinstall`

`packages/database` could generate the client on install, which is the common
Prisma arrangement. It is not used here because it would make `pnpm install`
depend on `DATABASE_URL`: `prisma generate` does not read it, but a developer who
adds an `env()` reference to the schema would then be unable to install without a
`.env` file. Generating at build time keeps the failure at the step that
actually needs the client. (Verified on 2026-10-03: `pnpm run db:generate` exits
0 with `DATABASE_URL` unset, which is why moving it earlier than the build is
safe.)

## Consequences

- A local `pnpm verify` on a fresh clone now reproduces CI. That is the point:
  the previous agreement was an accident of one machine's `node_modules`.
- `lint` and `typecheck` report a genuine compile error when the code does not
  compile. Typed linting over code that does not compile describes types that
  are not the program's types, so this is accurate rather than misleading.
- CI's `Generate Prisma client` step in the `verify` job is now redundant with
  what the scripts do. It is left in place: it is explicit about the intent, and
  it also precedes the schema validation step.
- CI run #3 completed green on a clean GitHub runner, proving the scripts start
  from fresh-checkout state and closing PHASE 01 criterion 5. The first run's
  failures were not masked; the final result is recorded in `PROJECT_STATE.md`
  and `docs/TESTING.MD`.

## Alternatives considered

- **Add the missing step to each CI job.** This is what was there before, and it
  is the arrangement that produced the defect: three jobs, one correct, and the
  two wrong ones failing for a reason their YAML does not mention.
- **Commit the build outputs.** `dist/` and the generated Prisma client would make
  every checkout pre-built, and would put generated artefacts under version
  control that can silently disagree with the source they came from.

## Legal

No legal implications identified.
