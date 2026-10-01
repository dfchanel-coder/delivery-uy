# ADR-017 - Test Transform of NestJS Sources

Status: ACCEPTED

Supersedes nothing. Refines ADR-016 (testing topology) and ADR-007 (toolchain).

## Context

ADR-016 chose `vitest` as the test runner. Vitest transforms TypeScript with
esbuild, and esbuild strips types without running the TypeScript compiler.

NestJS dependency injection resolves constructor parameters through the
`design:paramtypes` metadata that only `emitDecoratorMetadata` produces
(`packages/typescript-config/app.json`). Without that metadata Nest instantiates
controllers and providers with **no** constructor arguments. The application
still boots, routes are mapped, and the failure appears later at request time as
`Cannot read properties of undefined (reading '<dependency>')` inside the
controller - a misleading message that hides the real cause.

Options considered:

1. **SWC** (`unplugin-swc` + `@swc/core`) - emits decorator metadata, but adds a
   large native dependency whose postinstall must be allowlisted and whose
   native binary failed to load on the development machine used for PHASE 01
   (SWC's own native cache/DACL validation). A test suite that cannot run on the
   developer's machine is worse than the problem it solves.
2. **Explicit `@Inject(TOKEN)` on every dependency** - works without decorator
   metadata, but imposes a permanent, unidiomatic tax on every provider for the
   rest of the project and hides DI intent behind boilerplate.
3. **Compile `services/api` sources with the TypeScript compiler inside Vite** -
   reuses the `typescript` version already pinned for the build, adds no
   dependency, and works identically on developer machines and in CI.

## Decision

- Vitest keeps esbuild for every workspace (`packages/*` have no decorators).
- `test/ts-decorator-metadata-plugin.ts` transforms `services/api/src/**` with
  `typescript.transpileModule`, reading its compiler options directly from
  `services/api/tsconfig.json` so the test transform can never drift from
  `tsc -b`.
- The plugin is a normal, documented module; it is not hidden magic. If NestJS
  ever ships a metadata-free DI mode, the plugin can be deleted in one commit.
- Root tooling entry points (`vitest.config.ts`, `test/**`) are typechecked by
  their own project, `test/tsconfig.json`, which `pnpm typecheck` runs in
  addition to the reference build. They are never compiled into a package.
- `vite` is a root devDependency because the repository now contains a Vite
  plugin and therefore depends on Vite's types.

## Consequences

- Integration tests exercise the same Nest metadata semantics as production;
  DI bugs fail the suite instead of the runtime.
- Test startup is slightly slower than pure esbuild for `services/api`.
- Any future migration away from NestJS, or to a DI mode that does not need
  decorator metadata, can drop the plugin without touching application code.