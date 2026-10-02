import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sha256Hex } from '@deliveryuy/auth';
import type { Request } from 'express';
import {
  RATE_LIMIT_KEY,
  type RateLimitOptions,
  type RequestWithPrincipal,
} from '../security/endpoint-security.js';
import { rateLimitKey } from './redis-rate-limiter.js';
import { RATE_LIMITER, rateLimited, type RateLimiter } from './rate-limiter.js';

export interface RateLimitedRequestBody {
  email?: unknown;
}

/**
 * Applies the rate limits declared with `@RateLimit`.
 *
 * Runs after `JwtAuthGuard`, so a `user`-scoped limit is keyed on a verified
 * identity rather than on a client-supplied value. Every limit of a route is
 * consumed: a request blocked by one of them is refused even if another still
 * has budget, and both counters record the attempt.
 *
 * The email address is hashed into the key: Redis holds operational counters,
 * and a readable address there would turn a cache dump into a customer list.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  public constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const limits = this.reflector.getAllAndOverride<readonly RateLimitOptions[]>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (limits === undefined || limits.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();

    for (const options of limits) {
      const decision = await this.limiter.consume(this.keyFor(options, request), {
        limit: options.limit,
        windowSeconds: options.windowSeconds,
      });

      if (decision.allowed) continue;

      this.logger.warn(
        `Rate limit reached: ${options.name} retryAfter=${decision.retryAfterSeconds}s`,
      );

      throw rateLimited({
        limit: options.limit,
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }

    return true;
  }

  private keyFor(options: RateLimitOptions, request: Request & RequestWithPrincipal): string {
    const parts = [options.name, options.scope];

    switch (options.scope) {
      case 'user':
        // A public route asking for a user-scoped limit is a configuration
        // mistake; falling back to the address keeps the limit meaningful
        // instead of collapsing every caller into one shared counter.
        return rateLimitKey([...parts, request.principal?.userId ?? `ip:${ipOf(request)}`]);
      case 'email': {
        const email = emailOf(request);

        // Guards run before the validation pipe, so a body without an address
        // still reaches this point. Counting it under the client address keeps
        // the request counted somewhere instead of failing with a server error.
        return rateLimitKey([
          ...parts,
          email.length > 0 ? sha256Hex(email) : `ip:${ipOf(request)}`,
        ]);
      }
      case 'ip':
      default:
        return rateLimitKey([...parts, ipOf(request)]);
    }
  }
}

/**
 * Client address.
 *
 * Only meaningful when the deployment declares how many proxies sit in front
 * (`TRUST_PROXY_HOPS`); otherwise every request appears to come from the proxy
 * and one office could exhaust a shared limit.
 */
function ipOf(request: Request): string {
  const address = request.ip;
  return typeof address === 'string' && address.length > 0 ? address : 'unknown';
}

/** Normalized address from the body, used only to derive a hash. */
function emailOf(request: Request): string {
  const body = request.body as RateLimitedRequestBody | undefined;
  const email = body?.email;

  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}
