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
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/dist/**', '**/.next/**', '**/*.spec.ts', '**/*.module.ts', '**/index.ts'],
    },
  },
});
