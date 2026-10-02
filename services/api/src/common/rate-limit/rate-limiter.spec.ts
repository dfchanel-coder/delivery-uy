import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  RATE_LIMITER,
  rateLimited,
  rateLimiterUnavailable,
} from './rate-limiter.js';
import { rateLimitKey, RATE_LIMIT_NAMESPACE, RedisRateLimiter } from './redis-rate-limiter.js';

const WINDOW = { limit: 3, windowSeconds: 60 };

describe('RATE_LIMITER token', () => {
  it('is a distinct string, so it cannot collide with a class token', () => {
    expect(typeof RATE_LIMITER).toBe('string');
    expect(RATE_LIMITER).toBe('DELIVERYUY_RATE_LIMITER');
  });
});

describe('InMemoryRateLimiter', () => {
  function fixedClock(): { now: () => number; advance: (ms: number) => void } {
    let current = 1_000_000;

    return { now: () => current, advance: (ms: number) => (current += ms) };
  }

  it('allows exactly the configured number of requests in a window', async () => {
    const limiter = new InMemoryRateLimiter(fixedClock().now);

    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      decisions.push(await limiter.consume('key', WINDOW));
    }

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
    expect(decisions.at(-1)?.remaining).toBe(0);
    expect(decisions.at(-1)?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each key separately', async () => {
    const limiter = new InMemoryRateLimiter(fixedClock().now);

    await limiter.consume('first', WINDOW);
    await limiter.consume('first', WINDOW);
    const other = await limiter.consume('second', WINDOW);

    expect(other.allowed).toBe(true);
  });

  it('starts a fresh window once the previous one has passed', async () => {
    const clock = fixedClock();
    const limiter = new InMemoryRateLimiter(clock.now);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await limiter.consume('key', WINDOW);
    }
    expect((await limiter.consume('key', WINDOW)).allowed).toBe(false);

    clock.advance(60_000);

    expect((await limiter.consume('key', WINDOW)).allowed).toBe(true);
  });
});

describe('rateLimitKey', () => {
  it('namespaces every key', () => {
    expect(rateLimitKey(['auth:login:ip', 'ip', '203.0.113.7'])).toBe(
      `${RATE_LIMIT_NAMESPACE}:auth:login:ip:ip:203.0.113.7`,
    );
  });

  it('keeps distinct scopes apart', () => {
    expect(rateLimitKey(['name', 'ip', 'x'])).not.toBe(rateLimitKey(['name', 'email', 'x']));
  });
});

describe('RedisRateLimiter', () => {
  /** Minimal double: it records the script and answers with a scripted reply. */
  function fakeRedis(reply: unknown, failure?: Error): Redis {
    return {
      eval: vi.fn(failure === undefined ? async () => reply : async () => Promise.reject(failure)),
      quit: vi.fn(async () => 'OK'),
    } as unknown as Redis;
  }

  it('increments and sets the expiry in one round trip', async () => {
    const redis = fakeRedis([1, 60]);
    const limiter = new RedisRateLimiter(redis);

    const decision = await limiter.consume('key', WINDOW);

    expect(decision).toEqual({ allowed: true, limit: 3, remaining: 2, retryAfterSeconds: 60 });
    // One `eval`, not an INCR followed by an EXPIRE and a TTL: a crash between
    // two round trips would leave a counter that never expires.
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('accepts the string replies Redis sends over RESP', async () => {
    const limiter = new RedisRateLimiter(fakeRedis(['4', '12']));

    const decision = await limiter.consume('key', WINDOW);

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBe(12);
  });

  it('treats an already elapsed window as retryable at once', async () => {
    // Redis answers -1 for a key without TTL and -2 for a key that is gone.
    expect(
      (await new RedisRateLimiter(fakeRedis([1, -2])).consume('key', WINDOW)).retryAfterSeconds,
    ).toBe(0);
    expect(
      (await new RedisRateLimiter(fakeRedis([1, -1])).consume('key', WINDOW)).retryAfterSeconds,
    ).toBe(0);
  });

  it('fails closed when the shared store is unreachable', async () => {
    const limiter = new RedisRateLimiter(fakeRedis(null, new Error('connection refused')));

    await expect(limiter.consume('key', WINDOW)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('fails closed on a reply it cannot interpret', async () => {
    const limiter = new RedisRateLimiter(fakeRedis('OK'));

    await expect(limiter.consume('key', WINDOW)).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('closes the connection on shutdown and tolerates a dead one', async () => {
    const redis = fakeRedis([1, 60]);
    await new RedisRateLimiter(redis).onModuleDestroy();
    expect(redis.quit).toHaveBeenCalledTimes(1);

    const dead = {
      quit: vi.fn(async () => Promise.reject(new Error('already closed'))),
    } as unknown as Redis;
    await expect(new RedisRateLimiter(dead).onModuleDestroy()).resolves.toBeUndefined();
  });
});

describe('rate limit errors', () => {
  it('carries the limit and the wait so a client can back off', () => {
    const error = rateLimited({ limit: 10, retryAfterSeconds: 42 });

    expect(error.code).toBe('RATE_LIMITED');
    expect(error.statusCode).toBe(429);
    expect(error.details).toEqual({ limit: 10, retryAfterSeconds: 42 });
  });

  it('reports an unavailable store as a dependency outage', () => {
    const error = rateLimiterUnavailable(new TypeError('boom'));

    expect(error.code).toBe('SERVICE_UNAVAILABLE');
    expect(error.statusCode).toBe(503);
    expect(error.details).toEqual({ reason: 'TypeError' });
  });
});
