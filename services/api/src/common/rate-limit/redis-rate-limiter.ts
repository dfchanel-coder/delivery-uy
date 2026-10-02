import type Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import {
  rateLimiterUnavailable,
  type RateLimitDecision,
  type RateLimitWindow,
  type RateLimiter,
} from './rate-limiter.js';

/**
 * Shared rate limiting backed by Redis.
 *
 * The increment and the expiry are applied by one Lua script so a key can never
 * survive without a TTL: two separate round trips would leave a window that
 * counts forever if the process died between them. `INCR` on a fresh key returns
 * 1, which is the only place that needs to set the expiry.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`;

/** Namespace so a key from another subsystem can never collide. */
export const RATE_LIMIT_NAMESPACE = 'deliveryuy:ratelimit';

export function rateLimitKey(parts: readonly string[]): string {
  return [RATE_LIMIT_NAMESPACE, ...parts].join(':');
}

/**
 * Narrows the Lua reply.
 *
 * `Array.isArray` on an `unknown` value narrows it to `any[]`, which would let
 * the two fields flow into the decision untyped. The reply comes from Redis, so
 * it is genuinely untrusted: it stays `unknown` until checked.
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export class RedisRateLimiter implements RateLimiter {
  private readonly logger = new Logger(RedisRateLimiter.name);

  public constructor(private readonly redis: Redis) {}

  public async consume(
    key: string,
    { limit, windowSeconds }: RateLimitWindow,
  ): Promise<RateLimitDecision> {
    let result: unknown;

    try {
      result = await this.redis.eval(CONSUME_SCRIPT, 1, key, String(windowSeconds));
    } catch (error: unknown) {
      this.logger.error(`Rate limit store unavailable for ${key}: ${String(error)}`);
      throw rateLimiterUnavailable(error);
    }

    if (!isUnknownArray(result) || result.length !== 2) {
      this.logger.error(`Unexpected rate limit reply for ${key}: ${JSON.stringify(result)}`);
      throw rateLimiterUnavailable(new Error('malformed rate limit reply'));
    }

    const [rawCount, rawTtl] = result;
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount);
    const ttl = typeof rawTtl === 'number' ? rawTtl : Number(rawTtl);

    if (!Number.isFinite(count) || !Number.isFinite(ttl)) {
      throw rateLimiterUnavailable(new Error('malformed rate limit reply'));
    }

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      // `count === 1` means INCR created the key, so this request opened the
      // window and there is nothing to wait for. Reporting the TTL here instead
      // would make this backend disagree with InMemoryRateLimiter, which returns
      // zero for the same situation, and switching RATE_LIMIT_BACKEND would then
      // change what a caller sees. Redis also answers -1 for a key without TTL
      // and -2 for one that is gone; both mean the window is already over.
      retryAfterSeconds: count === 1 || ttl <= 0 ? 0 : ttl,
    };
  }

  /**
   * Closes the shared connection on shutdown.
   *
   * Recognised by NestJS because the method name matches its lifecycle contract,
   * which keeps the client owned by the module rather than by a caller.
   */
  public async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      // A client that is already gone needs no shutdown work.
    }
  }
}
