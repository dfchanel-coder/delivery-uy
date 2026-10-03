# ADR-023 - Integration Spec Isolation

Status: ACCEPTED

## Context

ADR-016 decided that "each test file runs against its own isolated schema
(`TEST_SCHEMA` env var) created before the suite and dropped afterwards,
allowing parallel execution without cross-test interference".

The implementation never did this. `TEST_SCHEMA` does not appear anywhere in the
codebase except in that sentence and in a comment in
`infrastructure/docker/docker-compose.test.yml` that repeats it. What actually
happens is:

- one database, one schema (`public`), one URL from `DATABASE_URL`;
- `truncateAuthTables` / `resetAuthTables` between tests;
- `pool: 'forks'` with `singleFork: true`, so the suite cannot run files in
  parallel.

An accepted ADR contradicted by the implementation is a documentation defect: a
reader trusts "own isolated schema" and concludes parallel execution is safe,
which is the opposite of what the code does. AGENTS.md section 3 requires a new
ADR explaining a changed decision rather than silently contradicting one.

The choice is between implementing per-schema isolation and recording the
topology that was actually chosen and why.

## Decision

**Supersede the isolation bullet of ADR-016.** The suite uses a single schema
with explicit truncation between tests, serialised by `singleFork`.

### Why not per-schema isolation

- **Prisma migrations are per database, not per schema.** The schema is reached
  through `?schema=` on the connection URL, but `prisma migrate deploy` applies
  migrations against the database. Isolating each file would mean deploying the
  migration history once per file before the suite and dropping each schema
  afterwards: setup cost multiplied by the number of spec files, paid on every
  run and on every developer's machine, to obtain isolation that a single fork
  plus truncation already provides.
- **The behaviour that motivated isolation does not require it.** The specs share
  the auth tables deliberately - they exercise the same unique constraints and
  the same partial functional index that production uses. Per-file schemas would
  each need the same bootstrap, and a defect in the bootstrap would then be
  invisible: it would appear as a passing suite of empty databases.
- **Serialisation is already the binding constraint.** Several specs truncate
  tables the others are reading. `singleFork` is what makes that safe today;
  adding schemas would make it safe in a second, redundant way.
- **The cost is visible.** The suite takes about 55 seconds with real
  infrastructure. That is acceptable for a job that must run in CI anyway.

### What replaces it

- One schema, `public`, in the database named by `DATABASE_URL`.
- Every spec that writes truncates before it runs, through the shared helpers in
  `services/api/src/testing/infrastructure.ts`.
- `pool: 'forks'` with `singleFork: true`. `test/infrastructure/integration-suite.spec.ts`
  asserts this, so relaxing it fails a spec instead of producing flaky runs.
- `scripts/assert-integration-report.mjs` discovers the expected spec files from
  the filesystem and compares the set in both directions. A spec added without
  being run is reported, and a spec removed is reported.

### When to revisit

If the suite grows past roughly a minute of serial execution, or a spec needs
isolation from another's writes that truncation cannot express, per-file
isolation becomes worth its setup cost. At that point the migration cost is the
thing to optimise first, not the isolation itself.

## Consequences

- The comment in `infrastructure/docker/docker-compose.test.yml` that referenced
  `TEST_SCHEMA` was corrected; it described a mechanism that does not exist.
- `docs/TESTING.MD` states the real topology instead of the promised one.
- Parallel execution of integration specs is explicitly **not** available. Any
  future attempt must change this ADR, not just the vitest configuration.

## Related

- ADR-016 - Testing Topology (runner, real-infrastructure rule, provider contract
  tests). Still accepted; only its isolation bullet is superseded.