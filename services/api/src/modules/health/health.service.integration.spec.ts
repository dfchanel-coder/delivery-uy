/**
 * Readiness against real PostgreSQL and real Redis.
 *
 * PHASE 01 exit criterion 5 asks for a readiness probe that reports the database
 * and the cache as up. A double cannot settle that: the probe deliberately opens
 * its own short-lived clients (`DatabaseModule`), so what it measures includes a
 * TCP connect, PostgreSQL startup and authentication before the query runs. Both
 * are properties of the real server, and a double reports them as instant.
 *
 * The failure this guards against was found by running it. With a budget of
 * 2000 ms the probe answered `degraded` with `database check timed out` against a
 * healthy PostgreSQL whose cold connect takes about 2.1 s. An orchestrator acts on
 * that answer by removing a healthy replica from rotation.
 *
 * Only the paths a real server can show live here. What happens when a dependency
 * exceeds its budget is a timing property a double settles deterministically, so
 * it is covered in `health.service.spec.ts` instead of as a race against real
 * infrastructure.
 *
 * Skipped when either dependency is unreachable, like every other integration
 * spec. `scripts/assert-integration-report.mjs` turns a skip into a CI failure.
 */
import type Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '@deliveryuy/database';
import { HealthService } from './health.service.js';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { testAppConfig } from '../../testing/app-config.fixture.js';
import {
  closeDatabase,
  closeRedis,
  openDatabase,
  openRedis,
  withDatabase,
  withRedis,
} from '../../testing/infrastructure.js';

/** Builds the service under test, overriding only the health budget. */
function service(timeoutMs?: number): HealthService {
  return new HealthService(
    new AppConfigService(
      testAppConfig({
        ...(timeoutMs === undefined ? {} : { health: { timeoutMs } }),
        observability: { logLevel: 'silent' },
      }),
    ),
  );
}

/** Runs a body with the probe's own Redis client, always closing it. */
async function withProbeRedis<T>(body: (redis: Redis) => Promise<T>): Promise<T> {
  const redis = service().createRedisClient();

  try {
    return await body(redis);
  } finally {
    await redis.quit();
  }
}

describe('HealthService.readiness (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
    await openRedis();
  });

  afterAll(async () => {
    await closeDatabase();
    await closeRedis();
  });

  it('reports every dependency up within the shipped default budget', async (ctx) => {
    // No `timeoutMs` here on purpose: this asserts the budget the product ships,
    // not one the test picked to make it pass.
    //
    // The harness client is warm, so this covers the query path rather than the
    // cold connect the probe also pays in production. The cold path is covered
    // where it actually occurs: `scripts/verify-infrastructure.mjs` boots the
    // whole API and asks it over HTTP with a client it has never used.
    await withDatabase(ctx, async (client) => {
      await withRedis(ctx, async () => {
        await withProbeRedis(async (redis) => {
          const report = await service().readiness(client, redis);

          expect(report.dependencies.database.status).toBe('up');
          expect(report.dependencies.redis.status).toBe('up');
          expect(report.status).toBe('ready');
          expect(report.dependencies.database.error).toBeUndefined();
          expect(report.dependencies.database.latencyMs).toBeGreaterThanOrEqual(0);
        });
      });
    });
  });

  it('reports the database down when nothing is listening on the port', async (ctx) => {
    await withDatabase(ctx, async () => {
      await withRedis(ctx, async () => {
        // A real unreachable endpoint rather than a double that throws: the
        // failure has to travel the whole client path to reach the verdict.
        const url = new URL(process.env['DATABASE_URL'] ?? '');

        url.port = '1';

        const closed = createDatabaseClient({
          url: url.toString(),
          poolSize: 1,
          logLevel: 'error',
        });

        try {
          await withProbeRedis(async (redis) => {
            const report = await service().readiness(closed, redis);

            expect(report.status).toBe('degraded');
            expect(report.dependencies.database.status).toBe('down');
            expect(report.dependencies.database.error).toBeTruthy();
            // The other dependency is untouched, so an operator can tell one
            // outage from the whole service being down.
            expect(report.dependencies.redis.status).toBe('up');
          });
        } finally {
          // Closing a client whose engine never started throws
          // `PrismaClientInitializationError`. That is not hypothetical:
          // `HealthService` wraps this call in `closeQuietly` precisely so a
          // failed close cannot replace the verdict with an error.
          await closed.$disconnect().catch(() => undefined);
        }
      });
    });
  });
});
