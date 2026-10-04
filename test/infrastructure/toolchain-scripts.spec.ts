/**
 * Contracts for the pnpm scripts that decide whether a fresh checkout can be
 * verified at all.
 *
 * These three defects were found by the first CI run this repository ever had,
 * and every one of them was invisible locally for the same reason: the machine
 * the work was done on already had the build outputs and the generated Prisma
 * client sitting in `node_modules`. A local `pnpm verify` passed because of
 * leftover state, and reported that state as a property of the repository.
 *
 *   - `Build backend` failed in every job that ran it, because the root `build`
 *     compiles with `tsc -b`, which drives the TypeScript compiler directly and
 *     never runs a package's own `build` script. `packages/database` generates
 *     the Prisma client in its `build`, so the client the root build depended on
 *     was never generated, and `@prisma/client` exported none of the enums
 *     `packages/database/src/enums.ts` imports.
 *   - `Lint` failed in the one job that generated the client first, because the
 *     typed rules resolve types through the compiled project references. With no
 *     `dist/*.d.ts` present, `HealthReadiness` imported by the admin panel had
 *     no resolvable type, and `no-unsafe-member-access` fired on every property
 *     read from it.
 *
 * Both are the same class of mistake: a prerequisite that was satisfied by
 * convention rather than declared. The contracts below are about declaration.
 */
import { describe, expect, it } from 'vitest';
import { readRepositoryFile } from '../support/repository-file.js';

interface PackageManifest {
  readonly scripts: Readonly<Record<string, string>>;
}

/** Scripts that compile the project references listed in the root tsconfig. */
const COMPILING_SCRIPTS = /\btsc\b[^|;&]*-b\s+tsconfig\.json/;

const rootManifest = (): PackageManifest =>
  JSON.parse(readRepositoryFile('package.json')) as PackageManifest;

const databaseManifest = (): PackageManifest =>
  JSON.parse(readRepositoryFile('packages/database/package.json')) as PackageManifest;

describe('the root scripts', () => {
  it('declares a build that compiles the project references', () => {
    // The premise of everything below: this is the script every job runs to get
    // a runnable API, so it is where a missing prerequisite has to be fixed.
    expect(rootManifest().scripts['build']).toContain('tsc -b tsconfig.json');
  });

  it('generates the Prisma client in every script that compiles', () => {
    // `tsc -b` builds each referenced project by invoking the compiler on its
    // tsconfig, not the package's `build` script. So `packages/database`'s own
    // `prisma:generate` never runs, and on a checkout that has not generated the
    // client yet the compile fails with `Module '"@prisma/client"' has no
    // exported member 'AppRole'` - an error that names the wrong culprit,
    // because the schema and the imports are both correct.
    //
    // `clean` is excluded because it takes the outputs away rather than producing
    // them: it invokes the same compiler with `--clean`, and generating a client
    // in order to delete it would be the opposite of what the script is for.
    const scripts = rootManifest().scripts;

    for (const [name, command] of Object.entries(scripts)) {
      if (COMPILING_SCRIPTS.test(command) && !command.includes('--clean')) {
        expect(command, `"${name}" compiles without generating the Prisma client`).toContain(
          'db:generate',
        );
      }
    }
  });

  it('compiles before linting, because the typed rules need the compiled types', () => {
    // ESLint is configured with `projectService: true`, so every rule that
    // reasons about a type resolves it through the project references. With no
    // declarations on disk the types are unresolved rather than wrong, and the
    // typed rules report that as a violation in the consumer - here ten errors in
    // one admin page, none of which mention the missing build.
    const lint = rootManifest().scripts['lint'] ?? '';

    expect(lint, 'lint lints without ensuring the types it lints against exist').toContain(
      'pnpm run build',
    );
    expect(lint, 'lint lints before building').toMatch(/pnpm run build\s*&&/);
  });

  it('runs the build as part of the test script', () => {
    // Vitest imports the packages through their `main`/`exports`, so a suite run
    // against a tree that was never compiled fails to resolve a module for a
    // reason that has nothing to do with the test.
    const test = rootManifest().scripts['test'] ?? '';

    expect(test, 'test runs without building first').toContain('pnpm run build');
  });

  it('compiles with a build that itself runs first in the verification gate', () => {
    // `verify` starts with `lint`, which now builds. This is what keeps a local
    // run honest: there is no step ordering to get wrong, because the ordering
    // lives in the script rather than in whoever typed the commands.
    const verify = rootManifest().scripts['verify'] ?? '';

    expect(verify.split('&&')[0]?.trim()).toBe('pnpm run lint');
  });
});

describe('the database package', () => {
  it('generates the client in its own build script', () => {
    // Kept as a fact, not as a request. The root deliberately does not reach it,
    // because `tsc -b` does not run package scripts - which is exactly why the
    // root has to generate the client itself.
    expect(databaseManifest().scripts['build'] ?? '').toContain('prisma:generate');
  });

  it('is reached by the project references the root compiles', () => {
    // If this reference were dropped, `packages/database` would stop compiling
    // as part of the root build and the compensation above would have nothing to
    // compensate for - silently, and with no failing test.
    const references = (
      JSON.parse(readRepositoryFile('tsconfig.json')) as {
        readonly references: readonly { readonly path: string }[];
      }
    ).references.map(({ path }) => path);

    expect(references).toContain('./packages/database');
  });
});
