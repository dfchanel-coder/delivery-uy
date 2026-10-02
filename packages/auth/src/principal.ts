import type { AccessTokenClaims } from './access-token.js';
import { type Permission, type Role, can, hasAnyRole, isRole } from './rbac.js';

/**
 * The authenticated caller as the rest of the application sees it.
 *
 * Guards and services receive this object and nothing else: no raw token, no
 * JWT payload, no client-supplied user id. Ownership checks compare
 * `principal.userId` against the row being touched, which is what stops IDOR
 * (AGENTS.md section 32, SECURITY.md "Authorization").
 */
export interface AuthenticatedPrincipal {
  readonly userId: string;
  /** Session that produced the access token. */
  readonly sessionId: string;
  readonly roles: readonly Role[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Builds a principal from verified claims.
 *
 * Unknown role names are dropped instead of being carried around: a token
 * minted by an older or compromised version of the platform must not be able to
 * introduce a role string that some future check treats as meaningful.
 */
export function principalFromClaims(claims: AccessTokenClaims): AuthenticatedPrincipal {
  return {
    userId: claims.subject,
    sessionId: claims.sessionId,
    roles: claims.roles.filter((role): role is Role => isRole(role)),
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
  };
}

/** Role check. Single role. */
export function principalHasRole(principal: AuthenticatedPrincipal, role: Role): boolean {
  return principal.roles.includes(role);
}

/** Role check for endpoints several roles may reach (driver and merchant, ...). */
export function principalHasAnyRole(
  principal: AuthenticatedPrincipal,
  roles: readonly Role[],
): boolean {
  return hasAnyRole(principal.roles, roles);
}

/**
 * Permission check.
 *
 * `ADMIN` grants nothing implicitly: a privileged action always names the roles
 * allowed to perform it (AGENTS.md section 70).
 */
export function principalCan(principal: AuthenticatedPrincipal, permission: Permission): boolean {
  return can(principal.roles, permission);
}

/**
 * Ownership check.
 *
 * The single place that answers "may this caller act on this record?", so a
 * missing owner check is a deliberate code change rather than an oversight in
 * one of many controllers.
 */
export function principalOwns(
  principal: AuthenticatedPrincipal,
  ownerUserId: string | null | undefined,
): boolean {
  if (typeof ownerUserId !== 'string' || ownerUserId.length === 0) return false;
  return principal.userId === ownerUserId;
}
