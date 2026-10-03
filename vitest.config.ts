import { defineConfig } from 'vitest/config';
import { decoratorMetadataPlugin } from './test/ts-decorator-metadata-plugin.js';

export default defineConfig({
  // NestJS needs `design:paramtypes`, which esbuild does not emit. See
  // test/ts-decorator-metadata-plugin.ts.
  plugins: [decoratorMetadataPlugin()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup-env.ts'],
    include: [
      'packages/*/src/**/*.spec.ts',
      'services/*/src/**/*.spec.ts',
      'apps/*/src/**/*.spec.ts',
      // Contracts about the repository itself: the compose files, the CI
      // workflow and the example environment. They read files rather than call
      // the application, so they live at the root instead of inside a package.
      'test/**/*.spec.ts',
    ],
    // Integration specs live next to the adapter they cover but are named
    // `*.integration.spec.ts`, and the ordinary suite never runs them: they need
    // real PostgreSQL or Redis (ADR-016). `vitest.integration.config.ts` is the
    // other half of that split.
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/dist/**', '**/.next/**', '**/*.spec.ts', '**/*.module.ts', '**/index.ts'],
    },
  },
});
