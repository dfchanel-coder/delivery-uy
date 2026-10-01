// Root ESLint entry point.
//
// The shared rules live in @deliveryuy/eslint-config (ADR-007); this file only
// provides the repository root so that project references resolve.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBaseConfig,
  createBoundaryConfig,
  createToolingConfig,
} from '@deliveryuy/eslint-config';

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default [
  ...createBaseConfig({ tsconfigRootDir }),
  ...createToolingConfig({ tsconfigRootDir }),
  ...createBoundaryConfig(),
];
