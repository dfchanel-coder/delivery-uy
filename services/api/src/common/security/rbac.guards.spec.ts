import { describe, expect, it, vi } from 'vitest';
import {
  principalFromClaims,
  type AuthenticatedPrincipal,
  type Permission,
  type Role,
} from '@deliveryuy/auth';
import { PERMISSIONS_KEY, ROLES_KEY } from './endpoint-security.js';
import { PermissionsGuard, RolesGuard } from './rbac.guards.js';

/**
 * The role and permission guards, on their own terms.
 *
 * Both are registered globally, so they run in front of every request in the
 * process, and until this file existed neither was exercised by any test: no
 * route in the repository carried `@Roles()` or `@Permissions()`, so the only
 * thing that had ever decided their behaviour was that they had never been
 * reached. A guard that is wrong in the permissive direction is the worst kind of
 * untested code, because the failure is invisible until the first protected
 * endpoint ships - and then it is an authorization bypass.
 *
 * What these hold:
 *
 * - the default is permissive *only* because the route declares nothing, which
 *   is how a decorator-free route is meant to behave;
 * - a declared requirement is never satisfied accidentally;
 * - a caller is never told what they *do* have;
 * - a missing principal is a loud server bug, not a `403` that hides it.
 *
 * The policy itself is covered by `packages/auth/src/rbac.spec.ts`; this file is
 * about the translation from a decorator to a decision.
 */

/** A principal built the way production builds one, so the shape cannot drift. */
function principalFor(...roles: readonly string[]): AuthenticatedPrincipal {
  return principalFromClaims({
    subject: '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
    sessionId: '5c1d4a90-2b7e-4f3a-9c81-0d2e6f4a7b33',
    roles,
    issuedAt: new Date('2026-01-05T12:00:00.000Z'),
    expiresAt: new Date('2026-01-05T12:15:00.000Z'),
  });
}

/** Minimal stand-in for the `Reflector` reads the guards perform. */
function reflectorFor(metadata: unknown): { getAllAndOverride: ReturnType<typeof vi.fn> } {
  return { getAllAndOverride: vi.fn(() => metadata) };
}

/**
 * Minimal stand-in for an `ExecutionContext` carrying one HTTP request.
 *
 * Both `getHandler` and `getClass` answer `undefined`, which is also what the
 * guard sees for a metadata lookup that finds nothing on either target.
 */
function contextFor(request: unknown = {}): unknown {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

type Guard = { canActivate: (context: never) => boolean };

/** Runs the guard and returns whatever it threw, failing if it allowed the call. */
function thrownBy(guard: Guard, context: unknown): unknown {
  try {
    guard.canActivate(context as never);
  } catch (error: unknown) {
    return error;
  }

  throw new Error('expected the guard to refuse, and it allowed the request');
}

/** Shorthand for the common case: the structured `FORBIDDEN` the guards raise. */
function refused(guard: Guard, context: unknown): unknown {
  return thrownBy(guard, context);
}

/** Asserts a missing principal is a plain server error, not a client `403`. */
function expectMisconfiguration(error: unknown): void {
  const asError = error as Error;

  expect(asError).toBeInstanceOf(Error);
  // An `ApiException` would carry a client-facing code, which would tell the
  // caller they lacked a role - a different problem, and a much harder one to
  // diagnose from the outside.
  expect(asError).not.toHaveProperty('code', 'FORBIDDEN');
  expect(asError.message).toMatch(/JwtAuthGuard/);
}

describe('RolesGuard', () => {
  it('asks the reflector for the roles of the route', () => {
    const reflector = reflectorFor(['ADMIN']);

    new RolesGuard(reflector as never).canActivate(
      contextFor({ principal: principalFor('ADMIN') }) as never,
    );

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, expect.any(Array));
  });

  it('allows a route that declares no roles', () => {
    // The documented default: authentication is still required (JwtAuthGuard
    // runs first), so this is not an open door, it is just not a role check.
    const guard = new RolesGuard(reflectorFor(undefined) as never);

    expect(guard.canActivate(contextFor() as never)).toBe(true);
  });

  it('allows a route whose only requirement is a role the caller holds', () => {
    const guard = new RolesGuard(reflectorFor(['ADMIN']) as never);

    expect(guard.canActivate(contextFor({ principal: principalFor('ADMIN') }) as never)).toBe(true);
  });

  it('refuses a caller without the required role', () => {
    const guard = new RolesGuard(reflectorFor(['ADMIN']) as never);

    expect(refused(guard, contextFor({ principal: principalFor('CUSTOMER') }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
      details: { requiredRoles: ['ADMIN'] },
    });
  });

  it('accepts any one of several roles, not all of them', () => {
    const guard = new RolesGuard(reflectorFor(['MERCHANT', 'DRIVER']) as never);

    expect(guard.canActivate(contextFor({ principal: principalFor('DRIVER') }) as never)).toBe(
      true,
    );
    expect(refused(guard, contextFor({ principal: principalFor('CUSTOMER') }))).toBeDefined();
  });

  it('reads several roles off one principal', () => {
    // A user with both ADMIN and FINANCE must reach either route.
    const guard = new RolesGuard(reflectorFor(['FINANCE']) as never);

    expect(
      guard.canActivate(contextFor({ principal: principalFor('ADMIN', 'FINANCE') }) as never),
    ).toBe(true);
  });

  it('does not treat ADMIN as a SUPER_ADMIN', () => {
    // The single most important line in the matrix. An ADMIN token on a
    // SUPER_ADMIN route must be refused, not treated as "close enough".
    const guard = new RolesGuard(reflectorFor(['SUPER_ADMIN']) as never);

    expect(refused(guard, contextFor({ principal: principalFor('ADMIN') }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('ignores a role the platform does not know', () => {
    // `principalFromClaims` drops unknown role strings, so a token minted by an
    // older or tampered-with version of the platform cannot smuggle in a role
    // that some future check treats as meaningful. Asserting it here because a
    // route asking for `ROOT` must be unreachable by a token that literally says
    // `ROOT`.
    const principal = principalFor('ADMIN', 'ROOT', 'OWNER');

    expect(principal.roles).toEqual(['ADMIN']);

    const guard = new RolesGuard(reflectorFor(['ROOT'] as unknown as Role[]) as never);

    expect(refused(guard, contextFor({ principal }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('allows a route that declares an empty role list', () => {
    // `@Roles()` with no arguments is a mistake, and this is what it currently
    // produces: the route is reachable by any authenticated caller. Pinned so the
    // behaviour is a decision on record rather than a surprise. If this ever
    // changes to a refusal, the failure it prevents is an unprotected privileged
    // route - the permissive direction is the dangerous one.
    const guard = new RolesGuard(reflectorFor([]) as never);

    expect(guard.canActivate(contextFor({ principal: principalFor('CUSTOMER') }) as never)).toBe(
      true,
    );
  });

  it('reports a missing principal as a server bug rather than a refusal', () => {
    // Reaching this means the guard chain is misconfigured: RolesGuard runs after
    // JwtAuthGuard, which always attaches a principal on a non-public route.
    // Answering 403 would tell a client it lacked a role, which is a different
    // problem and a much harder one to diagnose.
    const guard = new RolesGuard(reflectorFor(['ADMIN']) as never);

    expectMisconfiguration(refused(guard, contextFor({})));
  });
});

describe('PermissionsGuard', () => {
  it('asks the reflector for the permissions of the route', () => {
    const reflector = reflectorFor(['admin:orders:read']);

    new PermissionsGuard(reflector as never).canActivate(
      contextFor({ principal: principalFor('ADMIN') }) as never,
    );

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(PERMISSIONS_KEY, expect.any(Array));
  });

  it('allows a route that declares no permissions', () => {
    const guard = new PermissionsGuard(reflectorFor(undefined) as never);

    expect(guard.canActivate(contextFor() as never)).toBe(true);
  });

  it('allows a caller holding the permission', () => {
    const guard = new PermissionsGuard(reflectorFor(['admin:orders:read']) as never);

    expect(guard.canActivate(contextFor({ principal: principalFor('ADMIN') }) as never)).toBe(true);
  });

  it('requires every permission, not any of them', () => {
    // The difference that makes this guard stricter than RolesGuard. `ADMIN`
    // holds `admin:payments:read` but not `admin:refunds:create`, so this pair
    // separates the two readings: an "any" guard would let ADMIN through, quietly
    // reducing the endpoint to its weaker clause.
    const guard = new PermissionsGuard(
      reflectorFor(['admin:payments:read', 'admin:refunds:create']) as never,
    );

    expect(refused(guard, contextFor({ principal: principalFor('ADMIN') }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
      details: {
        requiredPermissions: ['admin:payments:read', 'admin:refunds:create'],
      },
    });
  });

  it('allows a caller holding every permission of a multi-permission route', () => {
    const guard = new PermissionsGuard(
      reflectorFor(['admin:payments:read', 'admin:refunds:create']) as never,
    );

    // FINANCE holds both; SUPER_ADMIN holds both; ADMIN holds only the first.
    expect(guard.canActivate(contextFor({ principal: principalFor('FINANCE') }) as never)).toBe(
      true,
    );
  });

  it('refuses ADMIN on a permission only FINANCE and SUPER_ADMIN hold', () => {
    // `admin:refunds:create` is the canonical example of an action ADMIN must
    // not reach (AGENTS.md section 70).
    const guard = new PermissionsGuard(reflectorFor(['admin:refunds:create']) as never);

    expect(refused(guard, contextFor({ principal: principalFor('ADMIN') }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    expect(guard.canActivate(contextFor({ principal: principalFor('FINANCE') }) as never)).toBe(
      true,
    );
  });

  it('refuses every caller, including SUPER_ADMIN, for a permission that does not exist', () => {
    // The failure this prevents is the dangerous direction: a permission name
    // with a typo, or one removed from the matrix while a decorator still names
    // it, must fail closed. If an ungranted name ever read as "nothing was
    // asked", the endpoint would be open to everyone who can reach it.
    const typo = 'admin:order:read' as Permission;
    const guard = new PermissionsGuard(reflectorFor([typo]) as never);

    expect(refused(guard, contextFor({ principal: principalFor('SUPER_ADMIN') }))).toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    });
  });

  it('never tells the caller what it does have', () => {
    // The refusal names what the route needs, because that is documented and
    // useful for support. It must not also describe the caller's own permissions:
    // that turns any protected endpoint into a probe for the authorization
    // policy, and an unprivileged account can use the answer to map the system.
    const guard = new PermissionsGuard(reflectorFor(['admin:refunds:create']) as never);
    const error = refused(guard, contextFor({ principal: principalFor('CUSTOMER') })) as {
      details?: Record<string, unknown>;
      message?: string;
    };

    const details = JSON.stringify(error.details ?? {});
    const message = error.message ?? '';

    expect(details).not.toContain('granted');
    expect(details).not.toContain('roles');
    expect(message.toLowerCase()).not.toContain('customer');
    expect(message.toLowerCase()).not.toContain('role you');
  });

  it('allows a route that declares an empty permission list', () => {
    // Same deliberate reading as the empty `@Roles()`, and the same reason: pinned
    // so it cannot change silently.
    const guard = new PermissionsGuard(reflectorFor([]) as never);

    expect(guard.canActivate(contextFor({ principal: principalFor('CUSTOMER') }) as never)).toBe(
      true,
    );
  });

  it('reports a missing principal as a server bug rather than a refusal', () => {
    const guard = new PermissionsGuard(reflectorFor(['admin:orders:read']) as never);

    expectMisconfiguration(refused(guard, contextFor({})));
  });
});
