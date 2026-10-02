import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@deliveryuy/types';
import { ApiException } from '../errors/api-exception.js';

/**
 * Rate limiting ports (SECURITY.md "Rate Limits").
 *
 * Login, register, password recovery and delivery verification are the
 * expensive or abusable endpoints. The limiter is an interface so the algorithm
 * (fixed window) can stay simple while the storage moves between a single
 * process and a shared Redis instance.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /**
   * Seconds until the current window resets.
   *
   * Zero when the window has just been opened, because there is nothing to wait
   * for yet. Always at least 1 once a request is blocked.
   *
   * Both backends must agree on this field: switching `RATE_LIMIT_BACKEND`
   * between the in-process and the shared store cannot be allowed to change what
   * a caller observes.
   */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, options: RateLimitWindow): Promise<RateLimitDecision>;
}

export interface RateLimitWindow {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * Injection token.
 *
 * `RateLimiter` is an interface with no runtime value, so the concrete backend
 * (Redis or in-process) is bound to this token in `RateLimitModule`.
 */
export const RATE_LIMITER = 'DELIVERYUY_RATE_LIMITER';

interface Counter {
  count: number;
  resetAtMs: number;
}

/**
 * Single-process limiter.
 *
 * Correct only while one instance serves the traffic. It is the default for
 * tests, and an explicit choice for development (`RATE_LIMIT_BACKEND=memory`);
 * with several instances every one of them keeps its own counters, so the
 * effective limit multiplies by the number of instances. That trade-off is why
 * the default backend is Redis.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly counters = new Map<string, Counter>();

  public constructor(private readonly now: () => number = () => Date.now()) {}

  public consume(key: string, window: RateLimitWindow): Promise<RateLimitDecision> {
    return Promise.resolve(this.decide(key, window));
  }

  /**
   * The algorithm is synchronous on purpose: the whole point of the in-process
   * backend is that no I/O is involved, so the decision is atomic for the
   * lifetime of one event-loop turn.
   */
  private decide(key: string, { limit, windowSeconds }: RateLimitWindow): RateLimitDecision {
    const nowMs = this.now();
    const existing = this.counters.get(key);

    if (existing === undefined || existing.resetAtMs <= nowMs) {
      this.counters.set(key, { count: 1, resetAtMs: nowMs + windowSeconds * 1000 });
      this.prune(nowMs);

      return { allowed: true, limit, remaining: Math.max(0, limit - 1), retryAfterSeconds: 0 };
    }

    existing.count += 1;
    const allowed = existing.count <= limit;

    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
    };
  }

  /** Keeps the map bounded: counters of past windows are useless. */
  private prune(nowMs: number): void {
    if (this.counters.size < 1_000) return;

    for (const [key, counter] of this.counters) {
      if (counter.resetAtMs <= nowMs) this.counters.delete(key);
    }
  }
}

/**
 * Rejects a request that exceeded its window.
 *
 * `retryAfterSeconds` travels in `details` so a client can back off without
 * guessing, and the code is the documented `RATE_LIMITED`.
 */
export function rateLimited(details: {
  readonly limit: number;
  readonly retryAfterSeconds: number;
}): ApiException {
  return new ApiException(
    ERROR_CODES.RATE_LIMITED,
    'Too many requests. Try again later.',
    details,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Fails closed.
 *
 * When the shared store is unreachable the request is refused instead of being
 * allowed through: an attacker who can make Redis unavailable must not thereby
 * remove the limit. The readiness probe reports the outage separately.
 */
export function rateLimiterUnavailable(cause: unknown): ApiException {
  return new ApiException(
    ERROR_CODES.SERVICE_UNAVAILABLE,
    'Request throttling is temporarily unavailable.',
    cause instanceof Error ? { reason: cause.name } : undefined,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
