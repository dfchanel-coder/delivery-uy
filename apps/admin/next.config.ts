import type { NextConfig } from 'next';

/**
 * `NEXT_STANDALONE_OUTPUT=true` produces a self-contained server bundle, which
 * is what the container image uses (ADR-001, section 79: components deploy
 * independently).
 *
 * It is opt-in because assembling the standalone tree requires creating
 * symlinks, which Windows refuses without Developer Mode or elevation. The
 * default build therefore works on any developer machine while Linux/CI can
 * still emit the self-contained bundle.
 */
const useStandaloneOutput = process.env['NEXT_STANDALONE_OUTPUT'] === 'true';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  ...(useStandaloneOutput ? { output: 'standalone' as const } : {}),
  eslint: {
    // Linting is owned by the repository ESLint configuration (flat config,
    // ADR-007) so every workspace is checked with the same rules and the same
    // type information. Running a second linter here would report different
    // results for the same file.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
