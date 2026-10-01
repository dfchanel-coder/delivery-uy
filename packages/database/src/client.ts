import { PrismaClient } from '@prisma/client';

export interface DatabaseClientOptions {
  readonly url: string;
  readonly poolSize?: number;
  readonly logQueries?: boolean;
  readonly logLevel?: 'info' | 'warn' | 'error';
}

/**
 * Creates a Prisma client configured for DeliveryUY.
 *
 * The client is instantiated explicitly (no global singleton) so that tests and
 * scripts can create isolated instances, and so that connection settings are
 * never implicit (ADR-009).
 */
export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  const logLevel = options.logLevel ?? 'error';

  return new PrismaClient({
    datasources: { db: { url: options.url } },
    log:
      options.logQueries === true
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'stdout', level: logLevel },
          ]
        : [{ emit: 'stdout', level: logLevel }],
  });
}

export type HealthCheckStatus = 'up' | 'down';

export interface DependencyHealth {
  readonly status: HealthCheckStatus;
  readonly latencyMs: number;
  readonly error?: string;
}

const HEALTH_QUERY = 'SELECT 1 AS ok';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('database check timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes a real round trip against PostgreSQL.
 *
 * Readiness must verify the database, not merely that the process started
 * (ADR-016, docs/TESTING.MD). The query is a constant with no interpolated
 * input, which is why `$queryRawUnsafe` is safe here.
 */
export async function checkDatabaseHealth(
  client: PrismaClient,
  timeoutMs = 2000,
): Promise<DependencyHealth> {
  const startedAt = Date.now();

  try {
    await withTimeout(client.$queryRawUnsafe(HEALTH_QUERY), timeoutMs);
    return { status: 'up', latencyMs: Date.now() - startedAt };
  } catch (error: unknown) {
    return {
      status: 'down',
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'unknown database error',
    };
  }
}

export { PrismaClient };
export type { Prisma } from '@prisma/client';
