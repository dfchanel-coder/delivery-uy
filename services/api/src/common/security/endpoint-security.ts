import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { AuthenticatedPrincipal, Permission, Role } from '@deliveryuy/auth';

/**
 * Endpoint security metadata (docs/API_RULES.md "Endpoint Security").
 *
 * Every endpoint must state which of the four categories it belongs to. The
 * default is the strictest one - authentication is required - so a new endpoint
 * that forgets to declare anything ends up protected rather than exposed.
 */

/** Opts a route out of authentication (health probes, login, register). */
export const IS_PUBLIC_KEY = 'deliveryuy:public';
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'deliveryuy:roles';
export const Roles = (...roles: readonly Role[]): CustomDecorator<string> =>
  SetMetadata(ROLES_KEY, roles);

export const PERMISSIONS_KEY = 'deliveryuy:permissions';
export const Permissions = (...permissions: readonly Permission[]): CustomDecorator<string> =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export interface RateLimitOptions {
  /** Requests allowed per window. */
  readonly limit: number;
  readonly windowSeconds: number;
  /**
   * What the counter is keyed on:
   * - `ip` protects against volume from one network;
   * - `email` protects one account without trusting the caller-supplied IP;
   * - `user` protects an authenticated account.
   */
  readonly scope: 'ip' | 'email' | 'user';
  /** Stable name, used to build the rate limit key. */
  readonly name: string;
}

export const RATE_LIMIT_KEY = 'deliveryuy:rate-limit';

/**
 * Declares one or more limits for a route.
 *
 * Several decorators would overwrite each other (metadata is a single value), so
 * a route that needs both a per-address and a per-network limit passes both at
 * once.
 */
export const RateLimit = (...options: readonly RateLimitOptions[]): CustomDecorator<string> =>
  SetMetadata(RATE_LIMIT_KEY, options);

export interface RequestWithPrincipal {
  principal?: AuthenticatedPrincipal;
}

/** Reads the principal a guard attached, failing loudly when it is missing. */
export function principalOf(context: ExecutionContext): AuthenticatedPrincipal {
  return principalFromRequest(context.switchToHttp().getRequest<RequestWithPrincipal>());
}

/** Same lookup for controllers that already hold the request object. */
export function principalFromRequest(request: RequestWithPrincipal): AuthenticatedPrincipal {
  const principal = request.principal;

  if (principal === undefined) {
    // Reaching this means a guard chain was misconfigured, not that the caller
    // misbehaved: it is a server bug and must not be answered as a client error.
    throw new Error('No principal on the request. Ensure JwtAuthGuard runs for this route.');
  }

  return principal;
}
