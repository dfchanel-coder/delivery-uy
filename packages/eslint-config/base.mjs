import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Shared DeliveryUY lint configuration (ADR-007).
 *
 * `boundaryConfig` encodes the rules from docs/MODULE_BOUNDARIES.md so that
 * architecture violations fail the build instead of a code review.
 */

/** Packages that must never import from apps or services. */
export const SHARED_PACKAGES = [
  'packages/config',
  'packages/types',
  'packages/auth',
  'packages/maps',
  'packages/payments',
  'packages/billing',
  'packages/notifications',
  'packages/storage',
  'packages/database',
];

export function createBaseConfig({ tsconfigRootDir }) {
  return [
    {
      ignores: [
        '**/dist/**',
        '**/coverage/**',
        '**/node_modules/**',
        '**/.next/**',
        '**/next-env.d.ts',
        '**/.dart_tool/**',
        '**/generated/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    prettier,
    {
      languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'module',
        globals: { ...globals.node },
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
      },
      rules: {
        // AGENTS.md section 99: strict typing; `any` requires justification.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        '@typescript-eslint/require-await': 'error',
        '@typescript-eslint/no-unnecessary-type-assertion': 'error',
        '@typescript-eslint/explicit-function-return-type': [
          'warn',
          { allowExpressions: true, allowTypedFunctionExpressions: true },
        ],
        eqeqeq: ['error', 'always'],
        'no-console': ['error', { allow: ['warn', 'error'] }],
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.object.name='Math'][object.property.name='round']",
            message:
              'Math.round on monetary values loses precision. Use Decimal helpers (ADR-008).',
          },
        ],
      },
    },
    {
      // Plain JavaScript tooling files are linted without type information: they
      // are not part of any tsconfig, and type-aware linting would fail.
      files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: false,
        },
      },
      rules: {
        ...tseslint.configs.disableTypeChecked.rules,
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        // CLI tooling must report progress on stdout; `no-console` protects
        // application code, not repository scripts.
        'no-console': 'off',
      },
    },
  ];
}

/**
 * Root tooling entry points (vitest, ESLint helpers) live outside the
 * TypeScript project references: they are executed by tools, never compiled into
 * a package. They still need type information, so they are linted against the
 * dedicated `test/tsconfig.json` project instead of an untyped default project.
 */
export function createToolingConfig({ tsconfigRootDir }) {
  return [
    {
      files: ['vitest.config.ts', 'test/**/*.ts'],
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: ['./test/tsconfig.json'],
          tsconfigRootDir,
        },
      },
    },
    {
      // The Prisma seed is a CLI script: it is compiled by tsconfig.seed.json and
      // run with node, never imported by the library, so it is linted against the
      // tooling project instead of the package build.
      files: ['packages/database/prisma/**/*.ts'],
      languageOptions: {
        parserOptions: {
          projectService: false,
          project: ['./test/tsconfig.json'],
          tsconfigRootDir,
        },
      },
      rules: {
        'no-console': 'off',
      },
    },
  ];
}

export function createBoundaryConfig() {
  return [
    {
      // packages/* must not import apps/* or services/* (ADR-007).
      files: SHARED_PACKAGES.map((pkg) => `${pkg}/**/*.ts`),
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/apps/**', '**/services/**'],
                message:
                  'packages/* must not import from apps/* or services/* (ADR-007, docs/MODULE_BOUNDARIES.md).',
              },
            ],
          },
        ],
      },
    },
    {
      // The database package is infrastructure only.
      files: ['packages/database/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/services/**', '**/apps/**'],
                message: 'packages/database must not depend on domain or transport code.',
              },
            ],
          },
        ],
      },
    },
    {
      // Controllers parse and delegate; they never touch the ORM.
      files: ['services/api/src/**/*.controller.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@prisma/client', '@deliveryuy/database'],
                message:
                  'Controllers must delegate to application services (AGENTS.md sections 80, 81).',
              },
            ],
          },
        ],
      },
    },
    {
      // Frontend applications are HTTP clients of the backend: no ORM, no
      // database package, no direct reach into service sources.
      files: ['apps/**/*.ts', 'apps/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@prisma/client', '@deliveryuy/database'],
                message:
                  'Applications must use the public HTTP API, never the ORM (docs/MODULE_BOUNDARIES.md).',
              },
              {
                group: ['**/services/api/src/**'],
                message:
                  'Applications must not import backend sources; consume the /api/v1 contract instead.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.spec.ts', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        // Test doubles are structurally minimal; asserting to the real type is
        // the idiomatic way to build them, and async stubs legitimately omit
        // `await`.
        '@typescript-eslint/no-unnecessary-type-assertion': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/unbound-method': 'off',
        'no-restricted-syntax': 'off',
      },
    },
  ];
}
