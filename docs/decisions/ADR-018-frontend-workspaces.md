# ADR-018 - Frontend Workspaces and Shared Client Logic

Status: ACCEPTED

Refines ADR-007 (monorepo layout).

## Context

`AGENTS.md` section 7 requires that shared logic lives in packages and is not
duplicated across applications, but the four frontends do not share a language:

- `apps/admin` is Next.js/TypeScript, built and linted by pnpm;
- `apps/customer`, `apps/merchant` and `apps/driver` are Flutter/Dart, built and
  analysed by the Dart toolchain.

Two client-transport concerns appeared in PHASE 01:

1. the `/api/v1` envelope (`{ "data": ... }` / `{ "error": ... }`);
2. the API origin and timeout, which must be configurable per build.

Implementing them three times in Dart, and separately in TypeScript, would be the
duplication `AGENTS.md` forbids.

Options considered:

1. **Force Dart into pnpm workspaces.** `pnpm` cannot manage pub
   dependencies; mixing both lockfiles in one directory tree makes "install
   everything" ambiguous and breaks reproducible installs.
2. **One Dart package per application, no sharing.** Simple, but guarantees
   three copies of the envelope decoder.
3. **A Dart package for the shared contracts, excluded from pnpm, referenced by
   path.** `pnpm-workspace.yaml` already documents that `packages/dart/*` is
   managed by the Dart toolchain.

## Decision

- `packages/dart/core` (`deliveryuy_core`) owns the cross-application Dart
  contracts: validated configuration from `--dart-define` values and the API
  envelope decoder. It has 15 unit tests and is consumed by the three
  applications through a path dependency.
- Dart workspaces are validated by `scripts/flutter-check.mjs`
  (`pnpm run flutter:check`), which runs `flutter analyze` and `flutter test` in
  each one. It is deliberately **not** part of `pnpm run verify`: the TypeScript
  gate must stay runnable on machines without Flutter. `pnpm run verify:all`
  chains both, and CI runs them as separate jobs.
- The TypeScript HTTP client (`apps/admin/src/lib/api-client.ts`) stays inside
  `apps/admin` while the admin panel is the only web client. It is written
  against the envelope contract rather than against generated types, so moving
  it to `packages/` later is a file move, not a rewrite. The ESLint boundary
  rules forbid applications from importing `@prisma/client`,
  `@deliveryuy/database` or backend sources, so a client can never quietly reach
  into the ORM.
- Next.js `output: 'standalone'` is opt-in through
  `NEXT_STANDALONE_OUTPUT=true`: assembling the standalone tree requires
  symlinks that Windows refuses without Developer Mode, and the default build
  must work on every developer machine.

## Consequences

- No business rule is duplicated across applications; only presentation is.
- Two toolchains, two lockfiles and one extra script (`flutter-check.mjs`). This
  is the cost of having a TypeScript web panel and three Flutter apps in one
  repository.
- A second web client would be the trigger to promote `api-client.ts` into
  `packages/`; the decision must be recorded here when it happens.