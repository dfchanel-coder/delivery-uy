/**
 * Test environment defaults.
 *
 * Secrets used here are throwaway development values. CI and local integration
 * runs provide real values through the environment; production values are never
 * committed (AGENTS.md sections 30, 62).
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  API_PORT: '3000',
  API_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://delivery:delivery@localhost:5432/deliveryuy_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-value-not-used-in-production',
  JWT_REFRESH_SECRET: 'test-refresh-secret-value-not-used-in-production',
  CORS_ORIGINS: 'http://localhost:3001',
  LOG_LEVEL: 'silent',
  DISPATCH_STRATEGY: 'proximity-v1',
};

for (const [key, value] of Object.entries(defaults)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
