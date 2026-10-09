/**
 * Pure RBAC policy evaluation (AGENTS.md sections 8, 32, 70).
 *
 * This module holds policy only. It performs no I/O and does not know about
 * NestJS guards: guards translate the authenticated user into a role list and
 * ask these predicates. `ADMIN` is deliberately not treated as unlimited
 * access - each privileged action names the roles that may perform it
 * (AGENTS.md section 70).
 */

export const ROLES = [
  'CUSTOMER',
  'MERCHANT',
  'DRIVER',
  'ADMIN',
  'SUPER_ADMIN',
  'SUPPORT',
  'FINANCE',
] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'admin:panel:read',
  'admin:users:read',
  'admin:users:manage',
  'admin:merchants:review',
  'admin:merchants:suspend',
  'admin:drivers:review',
  'admin:drivers:suspend',
  'admin:orders:read',
  'admin:payments:read',
  'admin:refunds:create',
  'admin:settlements:read',
  'admin:settlements:approve',
  'admin:support:manage',
  'admin:audit:read',
  'admin:config:write',
  'admin:delivery:exception-complete',
  'admin:feature-flags:write',
  'admin:risk-events:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Role -> permission matrix.
 *
 * `SUPER_ADMIN` is intentionally narrow: it does not implicitly grant
 * everything, so a new privileged action is never accidentally exposed to an
 * existing admin role.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = Object.freeze({
  CUSTOMER: [],
  MERCHANT: [],
  DRIVER: [],
  ADMIN: [
    'admin:panel:read',
    'admin:users:read',
    'admin:merchants:review',
    'admin:drivers:review',
    'admin:orders:read',
    'admin:payments:read',
    'admin:support:manage',
    'admin:risk-events:read',
  ],
  SUPER_ADMIN: [
    'admin:panel:read',
    'admin:users:read',
    'admin:users:manage',
    'admin:merchants:review',
    'admin:merchants:suspend',
    'admin:drivers:review',
    'admin:drivers:suspend',
    'admin:orders:read',
    'admin:payments:read',
    'admin:refunds:create',
    'admin:settlements:read',
    'admin:settlements:approve',
    'admin:support:manage',
    'admin:audit:read',
    'admin:config:write',
    'admin:delivery:exception-complete',
    'admin:feature-flags:write',
    'admin:risk-events:read',
  ],
  SUPPORT: [
    'admin:panel:read',
    'admin:orders:read',
    'admin:merchants:review',
    'admin:drivers:review',
  ],
  FINANCE: [
    'admin:panel:read',
    'admin:payments:read',
    'admin:refunds:create',
    'admin:settlements:read',
  ],
});

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Union of the permissions granted by the given roles. */
export function resolvePermissions(roles: readonly string[]): ReadonlySet<Permission> {
  const granted = new Set<Permission>();

  for (const role of roles) {
    if (!isRole(role)) continue;
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }

  return granted;
}

export function can(roles: readonly string[], permission: Permission): boolean {
  return resolvePermissions(roles).has(permission);
}

export function hasAnyRole(roles: readonly string[], expected: readonly Role[]): boolean {
  return roles.some((role) => expected.includes(role as Role));
}
