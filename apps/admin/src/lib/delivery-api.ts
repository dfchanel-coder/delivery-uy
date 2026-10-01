import { z } from 'zod';
import type { HealthLiveness, HealthReadiness } from '@deliveryuy/types';
import { createApiClient, type ApiClient } from './api-client';
import { getAdminEnv } from './config';

/**
 * Typed calls the admin panel makes against the backend today.
 *
 * The schemas mirror `packages/types`, but they are re-declared on purpose: a
 * client must fail loudly when the server contract drifts instead of silently
 * trusting its own compile-time copy.
 */
export const healthLivenessSchema = z.object({
  status: z.literal('ok'),
  service: z.string().min(1),
  environment: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
});

export const healthReadinessSchema = z.object({
  status: z.enum(['ready', 'degraded']),
  dependencies: z.object({
    database: z.object({
      status: z.enum(['up', 'down']),
      latencyMs: z.number().nonnegative(),
      error: z.string().optional(),
    }),
    redis: z.object({
      status: z.enum(['up', 'down']),
      latencyMs: z.number().nonnegative(),
      error: z.string().optional(),
    }),
  }),
  checkedAt: z.string().min(1),
});

let cachedClient: ApiClient | undefined;

export function getApiClient(): ApiClient {
  if (!cachedClient) {
    const env = getAdminEnv();
    cachedClient = createApiClient({ baseUrl: env.API_URL, timeoutMs: env.API_TIMEOUT_MS });
  }

  return cachedClient;
}

/** Test seam: drops the memoised client and environment. */
export function resetApiClientForTests(): void {
  cachedClient = undefined;
}

export async function fetchLiveness(): Promise<HealthLiveness> {
  return getApiClient().getData('/api/v1/health/live', healthLivenessSchema);
}

export async function fetchReadiness(): Promise<HealthReadiness> {
  return getApiClient().getData('/api/v1/health/ready', healthReadinessSchema);
}
