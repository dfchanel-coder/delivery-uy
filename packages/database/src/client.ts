import { PrismaClient } from '@prisma/client';

export interface DatabaseClientOptions {
  readonly url: string;
  readonly poolSize?: number;
  readonly transactionMaxWaitMs?: number;
  readonly transactionTimeoutMs?: number;
  readonly logQueries?: boolean;
  readonly logLevel?: 'info' | 'warn' | 'error';
}

/**
 * Ceiling for acquiring a connection in order to start an interactive
 * transaction.
 *
 * Prisma's own default is 2000ms, and that value is measurably too low for this
 * engine: two concurrent interactive transactions serialize inside the query
 * engine with a fixed penalty of roughly two seconds (measured, and independent
 * of the pool size, so it is not connection exhaustion). The second one
 * therefore loses the race against its own timeout and surfaces as "Unable to
 * start a transaction in the given time".
 *
 * That is not a theoretical concern here. Refresh-token rotation is an
 * interactive transaction, so two refreshes in flight at the same time — two
 * tabs, a client retry, two devices on one session — would turn a correct
 * `REFRESH_TOKEN_REUSED` outcome into a 500. Raising the ceiling above the
 * serialization delay is what makes the business rule observable again.
 */
export const DEFAULT_TRANSACTION_MAX_WAIT_MS = 10_000;

/**
 * Adds the pool ceiling to a PostgreSQL URL.
 *
 * The engine reads the connection limit from the datasource URL, so this is the
 * only way `poolSize` can take effect. The URL is edited as a string on purpose:
 * re-serialising it through `URL` would re-encode credentials that are already
 * valid as written.
 *
 * A URL that already pins `connection_limit` is rejected instead of silently
 * overridden, because two sources of truth for the same setting is exactly the
 * kind of ambiguity that makes a pool size untrustworthy.
 */
export function withConnectionLimit(url: string, poolSize: number): string {
  if (!Number.isInteger(poolSize) || poolSize < 1) {
    throw new RangeError(`poolSize must be a positive integer, received ${String(poolSize)}`);
  }

  if (/[?&]connection_limit=/.test(url)) {
    throw new Error('connection_limit is already set in the database URL');
  }

  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=${poolSize}`;
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
  const url =
    options.poolSize === undefined
      ? options.url
      : withConnectionLimit(options.url, options.poolSize);

  // Only `maxWait` is set by default. The execution timeout is left to the
  // engine unless a caller asks for something else, so this change cannot
  // quietly extend how long a slow transaction is allowed to run.
  const transactionOptions: { maxWait?: number; timeout?: number } = {
    maxWait: options.transactionMaxWaitMs ?? DEFAULT_TRANSACTION_MAX_WAIT_MS,
  };

  if (options.transactionTimeoutMs !== undefined) {
    transactionOptions.timeout = options.transactionTimeoutMs;
  }

  return new PrismaClient({
    datasources: { db: { url } },
    transactionOptions,
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
