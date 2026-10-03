import { describe, expect, it } from 'vitest';
import {
  principalFromClaims,
  type AuthenticatedPrincipal,
  type Permission,
  type Role,
} from '@deliveryuy/auth';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  Permissions,
  principalFromRequest,
  principalOf,
  Public,
  RATE_LIMIT_KEY,
  RateLimit,
  ROLES_KEY,
  Roles,
} from './endpoint-security.js';

/**
 * Endpoint security metadata: the decorators every route uses to declare its
 * category, and the lookup the role guards rely on.
 *
 * Two things here are contracts rather than conveniences.
 *
 * The first is that the decorators validate nothing. `@Roles('ROOT')` and
 * `@Permissions('admin:order:read')` store exactly what they were handed, so the
 * types stop a typo at compile time and nothing stops one at runtime. That is
 * why `PermissionsGuard` has to refuse a name the matrix does not contain: this
 * layer cannot. Asserted here so the weakness is recorded where it lives, and
 * so a future "helpful" validation that threw at decoration time is noticed
 * rather than assumed.
 *
 * The second is that a missing principal is a server fault. Reaching it means the
 * guard chain was wired wrong, not that the caller misbehaved, so it must not be
 * answered as a client error.
 */

function aPrincipal(): AuthenticatedPrincipal {
  return principalFromClaims({
    subject: '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
    sessionId: '5c1d4a90-2b7e-4f3a-9c81-0d2e6f4a7b33',
    roles: ['CUSTOMER'],
    issuedAt: new Date('2026-01-05T12:00:00.000Z'),
    expiresAt: new Date('2026-01-05T12:15:00.000Z'),
  });
}

/** Reads back metadata a decorator wrote onto a class. */
function declaredOn(target: object, key: string): unknown {
  return Reflect.getMetadata(key, target);
}

describe('endpoint security decorators', () => {
  it('marks a route public under its own key', () => {
    class Target {}
    Public()(Target);

    expect(declaredOn(Target, IS_PUBLIC_KEY)).toBe(true);
  });

  it('records the roles a route names', () => {
    class Target {}
    Roles('ADMIN', 'SUPPORT')(Target);

    expect(declaredOn(Target, ROLES_KEY)).toEqual(['ADMIN', 'SUPPORT']);
  });

  it('records the permissions a route names', () => {
    class Target {}
    Permissions('admin:orders:read', 'admin:refunds:create')(Target);

    expect(declaredOn(Target, PERMISSIONS_KEY)).toEqual([
      'admin:orders:read',
      'admin:refunds:create',
    ]);
  });

  it('records every limit a route declares', () => {
    // A route needing both a per-address and a per-network limit passes both at
    // once, because the metadata holds a single value and a second decorator
    // would overwrite the first.
    class Target {}
    RateLimit(
      { limit: 5, windowSeconds: 60, scope: 'email', name: 'auth.login' },
      { limit: 100, windowSeconds: 60, scope: 'ip', name: 'auth.login.network' },
    )(Target);

    expect(declaredOn(Target, RATE_LIMIT_KEY)).toEqual([
      { limit: 5, windowSeconds: 60, scope: 'email', name: 'auth.login' },
      { limit: 100, windowSeconds: 60, scope: 'ip', name: 'auth.login.network' },
    ]);
  });

  it('stores its own copy of the roles it was given', () => {
    // Rest parameters already copy, so a caller that reuses and mutates an array
    // of roles cannot retroactively widen a route's requirement.
    const roles: Role[] = ['ADMIN'];
    class Target {}
    Roles(...roles)(Target);

    roles.push('SUPER_ADMIN');

    expect(declaredOn(Target, ROLES_KEY)).toEqual(['ADMIN']);
  });

  it('stores a role name the platform does not define, unchallenged', () => {
    // Nothing here validates. The guarantee that an unknown role cannot open a
    // route lives in the matrix and in the guard, not in the decorator - which is
    // exactly why that guarantee needs its own test.
    class Target {}
    Roles('ROOT' as Role)(Target);

    expect(declaredOn(Target, ROLES_KEY)).toEqual(['ROOT']);
  });

  it('stores a permission name that does not exist, unchallenged', () => {
    class Target {}
    Permissions('admin:order:read' as Permission)(Target);

    expect(declaredOn(Target, PERMISSIONS_KEY)).toEqual(['admin:order:read']);
  });

  it('records nothing on a route that declares nothing', () => {
    // The state the guards treat as "no requirement stated", as opposed to an
    // empty list, which they also treat as no requirement - a distinction
    // `rbac.guards.spec.ts` pins.
    class Target {}

    expect(declaredOn(Target, ROLES_KEY)).toBeUndefined();
    expect(declaredOn(Target, PERMISSIONS_KEY)).toBeUndefined();
    expect(declaredOn(Target, IS_PUBLIC_KEY)).toBeUndefined();
  });
});

describe('principal lookup', () => {
  it('returns the principal a guard attached', () => {
    const principal = aPrincipal();

    expect(principalFromRequest({ principal })).toBe(principal);
  });

  it('reads the principal through the execution context', () => {
    // Controllers and guards go through the context, not the raw request.
    const principal = aPrincipal();
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ principal }) }),
    };

    expect(principalOf(context as never)).toBe(principal);
  });

  it.each([
    ['a request with no principal', {}],
    ['a request whose principal is null', { principal: null }],
  ])('throws a server error for %s', (_label, request) => {
    // Not an ApiException, and so not a 401 or a 403: answering a client error
    // here would say "you are not allowed" about a request that was never
    // authenticated, sending the reader after the wrong problem entirely.
    let thrown: unknown;

    try {
      principalFromRequest(request as never);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toHaveProperty('code');
    expect((thrown as Error).message).toMatch(/JwtAuthGuard/);
  });
});
