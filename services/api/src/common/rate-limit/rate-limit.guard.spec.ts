import { describe, expect, it, vi } from 'vitest';
import { RATE_LIMIT_KEY } from '../security/endpoint-security.js';
import { RATE_LIMITER, type RateLimiter, type RateLimitWindow } from './rate-limiter.js';
import { RateLimitGuard } from './rate-limit.guard.js';

/**
 * The guard's own logic: which limits a route declares, and which key each one
 * is counted under. The controllers' declarations are covered by the auth e2e
 * suite, which observes real 429 responses.
 */

interface PrincipalLike {
  userId: string;
}

/** Records the keys it is asked to consume, answering from a script. */
class RecordingLimiter implements RateLimiter {
  public readonly keys: string[] = [];

  public constructor(
    private readonly answers: { allowed: boolean; retryAfterSeconds?: number }[] = [],
  ) {}

  public async consume(key: string, window: RateLimitWindow) {
    this.keys.push(key);

    const answer = this.answers[this.keys.length - 1] ?? { allowed: true };

    return {
      allowed: answer.allowed,
      limit: window.limit,
      remaining: answer.allowed ? window.limit - 1 : 0,
      retryAfterSeconds: answer.retryAfterSeconds ?? 0,
    };
  }
}

/** Minimal stand-in for the `Reflector` reads the guard performs. */
function reflectorFor(limits: unknown): { getAllAndOverride: ReturnType<typeof vi.fn> } {
  return { getAllAndOverride: vi.fn(() => limits) };
}

/** Minimal stand-in for an `ExecutionContext` carrying one HTTP request. */
function contextFor(request: unknown): unknown {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

const LIMITS = [{ name: 'auth:login:ip', scope: 'ip', limit: 20, windowSeconds: 300 }] as const;
const EMAIL = 'person@example.com';

describe('RateLimitGuard', () => {
  it('asks the reflector for the limits of the route', async () => {
    const reflector = reflectorFor(LIMITS);
    const limiter = new RecordingLimiter();

    await new RateLimitGuard(reflector as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: {} }) as never,
    );

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(RATE_LIMIT_KEY, expect.any(Array));
  });

  it('does nothing on a route without limits', async () => {
    const limiter = new RecordingLimiter();

    const allowed = await new RateLimitGuard(reflectorFor(undefined) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7' }) as never,
    );

    expect(allowed).toBe(true);
    expect(limiter.keys).toHaveLength(0);
  });

  it('keys an ip limit on the client address', async () => {
    const limiter = new RecordingLimiter();

    await new RateLimitGuard(reflectorFor(LIMITS) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: {} }) as never,
    );

    expect(limiter.keys[0]).toContain('203.0.113.7');
  });

  it('keys a user limit on the verified identity, not on the request body', async () => {
    const limiter = new RecordingLimiter();
    const principal: PrincipalLike = { userId: 'user-1' };
    const limits = [{ name: 'auth:me', scope: 'user', limit: 60, windowSeconds: 60 }];

    await new RateLimitGuard(reflectorFor(limits) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', principal, body: { userId: 'someone-else' } }) as never,
    );

    expect(limiter.keys[0]).toContain('user-1');
    expect(limiter.keys[0]).not.toContain('someone-else');
  });

  it('never puts the address from the body into the key', async () => {
    const limiter = new RecordingLimiter();
    const limits = [{ name: 'auth:login:email', scope: 'email', limit: 10, windowSeconds: 900 }];

    await new RateLimitGuard(reflectorFor(limits) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: { email: 'person@example.com' } }) as never,
    );

    expect(limiter.keys[0]).not.toContain('person@example.com');
    // The hash is stable, so the same address always lands in the same bucket.
    expect(limiter.keys[0]).toMatch(/email:[0-9a-f]{64}$/);
  });

  it('consumes every limit of the route', async () => {
    const limiter = new RecordingLimiter();
    const limits = [
      { name: 'auth:login:ip', scope: 'ip', limit: 20, windowSeconds: 300 },
      { name: 'auth:login:email', scope: 'email', limit: 10, windowSeconds: 900 },
    ];

    await new RateLimitGuard(reflectorFor(limits) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: { email: 'person@example.com' } }) as never,
    );

    expect(limiter.keys).toHaveLength(2);
  });

  it('counts a body without an address under the client address', async () => {
    const limiter = new RecordingLimiter();
    const limits = [{ name: 'auth:login:email', scope: 'email', limit: 10, windowSeconds: 900 }];

    // Guards run before the validation pipe, so a malformed body reaches the
    // guard without an address. It must be counted, not crash the request.
    await new RateLimitGuard(reflectorFor(limits) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: {} }) as never,
    );

    expect(limiter.keys[0]).toContain('ip:203.0.113.7');
  });

  it('refuses the request as soon as one limit is exhausted', async () => {
    const limiter = new RecordingLimiter([
      { allowed: true },
      { allowed: false, retryAfterSeconds: 30 },
    ]);
    const limits = [
      { name: 'auth:login:ip', scope: 'ip', limit: 20, windowSeconds: 300 },
      { name: 'auth:login:email', scope: 'email', limit: 10, windowSeconds: 900 },
    ];

    const guard = new RateLimitGuard(reflectorFor(limits) as never, limiter);

    await expect(
      guard.canActivate(contextFor({ ip: '203.0.113.7', body: { email: EMAIL } }) as never),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      statusCode: 429,
      details: { limit: 10, retryAfterSeconds: 30 },
    });
  });

  it('falls back to the address when a user-scoped limit meets an anonymous request', async () => {
    const limiter = new RecordingLimiter();
    const limits = [{ name: 'auth:me', scope: 'user', limit: 60, windowSeconds: 60 }];

    await new RateLimitGuard(reflectorFor(limits) as never, limiter).canActivate(
      contextFor({ ip: '203.0.113.7', body: {} }) as never,
    );

    // Collapsing every anonymous caller into one shared counter would let a
    // single client consume everyone else's budget.
    expect(limiter.keys[0]).toContain('ip:203.0.113.7');
  });
});

describe('RATE_LIMITER', () => {
  it('is the token the guard resolves its backend from', () => {
    expect(RATE_LIMITER).toBeTypeOf('string');
  });
});
