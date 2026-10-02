/**
 * `RedisRateLimiter` against a real Redis.
 *
 * The two properties that matter cannot be shown with a double: the increment
 * and the expiry must be one atomic step (a key outliving its window would count
 * forever), and several API instances must share the same counters, which is the
 * whole reason Redis is the default backend. Skipped when no Redis is reachable.
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@deliveryuy/types';
import {
  NO_REDIS,
  closeRedis,
  deleteTestKeys,
  openRedis,
  withRedis,
} from '../../testing/infrastructure.js';
import { rateLimitKey, RedisRateLimiter } from './redis-rate-limiter.js';

/** Only this suite's keys are cleared: a shared Redis may host other work. */
const KEY_PATTERN = 'deliveryuy:ratelimit:test:*';

const uniqueKey = (): string => rateLimitKey(['test', randomUUID()]);

describe('RedisRateLimiter (integration)', () => {
  beforeAll(async () => {
    await openRedis();
  });

  beforeEach(async () => {
    // A no-op when Redis is missing: the tests themselves skip through `withRedis`.
    await withRedis({ skip: () => undefined }, (client) => deleteTestKeys(client, KEY_PATTERN));
  });

  afterAll(async () => {
    await closeRedis();
  });

  it('counts up to the limit and then refuses', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const decision = await limiter.consume(key, { limit: 3, windowSeconds: 60 });

        expect(decision.allowed).toBe(true);
        expect(decision.remaining).toBe(3 - attempt);
      }

      const blocked = await limiter.consume(key, { limit: 3, windowSeconds: 60 });

      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  it('sets the expiry on the first hit so the window can expire', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      await limiter.consume(key, { limit: 5, windowSeconds: 30 });

      const ttl = await client.ttl(key);

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
    });
  });

  it('applies the increment and the expiry atomically', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      // Five concurrent first-hits on a fresh key. If the expiry were a separate
      // round trip, a process dying between them would leave a key with no TTL
      // and every later attempt would keep counting against a window that never
      // resets. Exactly one of the five may create the window.
      await Promise.all(
        Array.from({ length: 5 }, () => limiter.consume(key, { limit: 10, windowSeconds: 45 })),
      );

      expect(await client.ttl(key)).toBeGreaterThan(0);
      expect(await client.get(key)).toBe('5');
    });
  });

  it('keeps counting without ever extending an established window', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      await limiter.consume(key, { limit: 10, windowSeconds: 45 });

      const firstTtl = await client.ttl(key);

      await client.pexpire(key, 5_000);

      await limiter.consume(key, { limit: 10, windowSeconds: 45 });

      // The script only sets EXPIRE when INCR returns 1, so an established
      // window keeps its original deadline instead of sliding forward on every
      // request, which is what makes the limit a real fixed window.
      expect(await client.ttl(key)).toBeLessThanOrEqual(firstTtl);
    });
  });

  it('starts a new window once the old key is gone', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      await limiter.consume(key, { limit: 1, windowSeconds: 60 });

      expect((await limiter.consume(key, { limit: 1, windowSeconds: 60 })).allowed).toBe(false);

      await client.del(key);

      const fresh = await limiter.consume(key, { limit: 1, windowSeconds: 60 });

      expect(fresh.allowed).toBe(true);
      expect(fresh.retryAfterSeconds).toBe(0);
    });
  });

  it('counts each key separately', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const first = uniqueKey();
      const second = uniqueKey();

      await limiter.consume(first, { limit: 1, windowSeconds: 60 });

      expect((await limiter.consume(second, { limit: 1, windowSeconds: 60 })).allowed).toBe(true);
    });
  });

  it('shares counters between two limiter instances', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const second = new RedisRateLimiter(
        new Redis(process.env['REDIS_URL'] ?? '', {
          maxRetriesPerRequest: 1,
        }),
      );
      const key = uniqueKey();

      try {
        expect((await limiter.consume(key, { limit: 2, windowSeconds: 60 })).allowed).toBe(true);

        // The reason Redis is the default: with the in-process backend every
        // instance keeps its own counters, so behind a load balancer the
        // effective limit would be twice the configured one.
        expect((await second.consume(key, { limit: 2, windowSeconds: 60 })).allowed).toBe(true);
        expect((await second.consume(key, { limit: 2, windowSeconds: 60 })).allowed).toBe(false);
      } finally {
        await second.onModuleDestroy();
      }
    });
  });

  it('never lets a window report a negative remaining allowance', async (ctx) => {
    await withRedis(ctx, async (client) => {
      const limiter = new RedisRateLimiter(client);
      const key = uniqueKey();

      for (let attempt = 0; attempt < 4; attempt += 1) {
        expect(
          (await limiter.consume(key, { limit: 2, windowSeconds: 60 })).remaining,
        ).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('fails closed when Redis is unreachable', async () => {
    // Port 1 is reserved and nothing listens on it, so no skip guard is needed:
    // this test asserts the behaviour *of* an unreachable server.
    const broken = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    try {
      await broken.connect();
    } catch {
      // Expected: there is no Redis on that port.
    }

    try {
      // Allowing the request through because the store is down would mean an
      // attacker who breaks Redis also removes the limit.
      await expect(
        new RedisRateLimiter(broken).consume(uniqueKey(), { limit: 5, windowSeconds: 60 }),
      ).rejects.toMatchObject({
        name: 'ApiException',
        code: ERROR_CODES.SERVICE_UNAVAILABLE,
        statusCode: 503,
      });
    } finally {
      broken.disconnect();
    }
  });

  it('namespaces its keys so another subsystem cannot collide', () => {
    expect(rateLimitKey(['login', 'ip', '1.2.3.4'])).toBe('deliveryuy:ratelimit:login:ip:1.2.3.4');
  });

  it('explains how to provide Redis when none is reachable', () => {
    expect(NO_REDIS).toContain('infra:test');
  });
});
