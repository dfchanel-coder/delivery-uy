import { z } from 'zod';

/**
 * Admin panel configuration.
 *
 * Every value is read from the environment and validated at the boundary, so a
 * misconfigured deployment fails loudly instead of silently pointing the panel
 * at the wrong API (AGENTS.md section 61).
 */
const adminEnvSchema = z.object({
  API_URL: z.string().url('API_URL must be an absolute URL').default('http://localhost:3000'),
  API_TIMEOUT_MS: z.coerce
    .number()
    .int('API_TIMEOUT_MS must be an integer')
    .min(500, 'API_TIMEOUT_MS must be at least 500')
    .max(30_000, 'API_TIMEOUT_MS must not exceed 30000')
    .default(5_000),
  ADMIN_PANEL_NAME: z.string().min(1).default('DeliveryUY Admin'),
});

export type AdminEnv = Readonly<z.infer<typeof adminEnvSchema>>;

export function loadAdminEnv(source: Record<string, string | undefined> = process.env): AdminEnv {
  const result = adminEnvSchema.safeParse(source);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid admin panel configuration -> ${detail}`);
  }

  return Object.freeze(result.data);
}

let cached: AdminEnv | undefined;

/** Memoised accessor for server components; tests use `loadAdminEnv` directly. */
export function getAdminEnv(): AdminEnv {
  cached ??= loadAdminEnv();
  return cached;
}
