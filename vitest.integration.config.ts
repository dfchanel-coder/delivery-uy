import { defineConfig } from 'vitest/config';

/**
 * Integration suite (ADR-016).
 *
 * Separate from `vitest.config.ts` on purpose. These specs assert behaviour that
 * only exists in real infrastructure: a partial functional index, a conditional
 * `updateMany` losing a race, transaction rollback after a thrown error, and a
 * Lua script running as one atomic step inside Redis. Mixing them into the
 * ordinary suite would make `pnpm test` silently skip a third of the suite on a
 * machine without Docker, which looks exactly like a passing run.
 *
 * Each spec skips when its dependency is unreachable, so this config is also
 * what CI uses to *prove* they ran: `test:integration` runs with the containers
 * up and the CI step asserts a minimum executed count.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['packages/*/src/**/*.integration.spec.ts', 'services/*/src/**/*.integration.spec.ts'],
    // A single worker: the specs truncate shared tables, so running them
    // concurrently would have them delete each other's rows.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The JSON report is always written, not only on CI: it is what proves the
    // specs actually executed instead of skipping. With `outputFile` set the
    // reporter writes to disk and prints nothing, so the terminal stays readable
    // and `pnpm test:integration && node scripts/assert-integration-report.mjs`
    // behaves the same on a laptop and on a runner.
    reporters: ['default', 'json'],
    outputFile: { json: 'integration-report.json' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage-integration',
      include: [
        'packages/database/src/**/*.ts',
        'services/api/src/common/rate-limit/**/*.ts',
        'services/api/src/modules/auth/**/*.ts',
      ],
      exclude: ['**/dist/**', '**/*.spec.ts', '**/*.module.ts', '**/index.ts', '**/ports.ts'],
    },
  },
});
