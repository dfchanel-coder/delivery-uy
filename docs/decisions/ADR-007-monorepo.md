# ADR-007 - Monorepo Layout and Package Manager

Status: ACCEPTED

## Context

The repository already declares four applications (`apps/customer`,
`apps/merchant`, `apps/driver`, `apps/admin`), one backend service
(`services/api`) and shared `packages/*`.

Two risks exist:

1. duplicated business logic across applications;
2. lock-in to heavy monorepo orchestration tooling that adds build complexity
   before the product exists.

## Decision

Use a **pnpm workspace monorepo** without an additional orchestration engine.

Workspace definition:

- `apps/*` - Flutter mobile applications and the Next.js admin application.
- `services/*` - NestJS backend services.
- `packages/*` - shared TypeScript libraries consumed by more than one
  service or application.

Tooling rules:

- pnpm workspaces for dependency linking.
- TypeScript `project references` for cross-package type checking.
- Root npm scripts orchestrate build/lint/typecheck/test. No Nx, Turborepo or
  Lerna until a measurable need exists.
- Shared ESLint and TypeScript configuration live in
  `packages/eslint-config` and `packages/typescript-config`.

Dependency direction (enforced by ESLint `no-restricted-imports` rules):

```
apps/*        -> services/api (HTTP client only), packages/*
services/api  -> packages/*
packages/*    -> packages/* (explicitly declared edges only)
```

Hard rules:

- a package must never import from `apps/*` or `services/*`;
- `packages/database` must never import from any domain package;
- Flutter applications must not contain authoritative business logic
  (AGENTS.md section 42). Shared Dart packages live under
  `packages/dart/*` when justified.

## Consequences

Positive:

- single `pnpm install` bootstraps the whole repository;
- shared business logic has exactly one implementation;
- independent deployment of `apps/*` and `services/*` remains possible.

Negative:

- TypeScript package build ordering must be maintained manually;
- root scripts get slower as workspaces grow.

Mitigation: project references produce deterministic topologically ordered
`tsc -b` builds.

## Alternatives considered

- **npm/yarn workspaces**: pnpm is chosen for strict `node_modules` layout,
  faster installs and better phantom-dependency detection.
- **Nx / Turborepo**: rejected as premature complexity. Re-evaluate when
  cacheable task graphs become a real bottleneck.
- **Separate repositories per application**: rejected because it would allow
  duplicated logic and cross-repository version drift.