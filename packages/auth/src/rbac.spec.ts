import { describe, expect, it } from 'vitest';
import { can, hasAnyRole, resolvePermissions, ROLE_PERMISSIONS } from './rbac.js';

describe('RBAC policy', () => {
  it('grants no admin permissions to self-service roles', () => {
    expect(resolvePermissions(['CUSTOMER']).size).toBe(0);
    expect(resolvePermissions(['DRIVER']).size).toBe(0);

    // MERCHANT holds its own profile permissions and nothing privileged: the
    // first non-admin permissions exist so a merchant can act on its own
    // business, never so it can reach the admin surface.
    const merchantPermissions = [...resolvePermissions(['MERCHANT'])];
    expect(merchantPermissions.length).toBeGreaterThan(0);
    expect(merchantPermissions.every((permission) => permission.startsWith('merchant:'))).toBe(
      true,
    );
    expect(can(['MERCHANT'], 'admin:panel:read')).toBe(false);
  });

  it('does not treat ADMIN as unlimited access (AGENTS.md section 70)', () => {
    expect(can(['ADMIN'], 'admin:panel:read')).toBe(true);
    expect(can(['ADMIN'], 'admin:refunds:create')).toBe(false);
    expect(can(['ADMIN'], 'admin:settlements:approve')).toBe(false);
    expect(can(['ADMIN'], 'admin:delivery:exception-complete')).toBe(false);
  });

  it('reserves destructive and financial actions for SUPER_ADMIN and FINANCE', () => {
    expect(can(['SUPER_ADMIN'], 'admin:refunds:create')).toBe(true);
    expect(can(['FINANCE'], 'admin:refunds:create')).toBe(true);
    expect(can(['SUPPORT'], 'admin:refunds:create')).toBe(false);
    expect(can(['FINANCE'], 'admin:delivery:exception-complete')).toBe(false);
    expect(can(['SUPER_ADMIN'], 'admin:delivery:exception-complete')).toBe(true);
  });

  it('ignores unknown roles instead of throwing', () => {
    expect(resolvePermissions(['NOT_A_ROLE']).size).toBe(0);
    expect(can(['NOT_A_ROLE'], 'admin:panel:read')).toBe(false);
  });

  it('unions permissions for multi-role users', () => {
    const permissions = resolvePermissions(['SUPPORT', 'FINANCE']);
    expect(permissions.has('admin:merchants:review')).toBe(true);
    expect(permissions.has('admin:refunds:create')).toBe(true);
    expect(permissions.has('admin:config:write')).toBe(false);
  });

  it('keeps the matrix frozen', () => {
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
    expect(() => {
      (ROLE_PERMISSIONS as Record<string, unknown>)['CUSTOMER'] = ['admin:panel:read'];
    }).toThrow(TypeError);
  });

  it('checks role membership for ad-hoc guards', () => {
    expect(hasAnyRole(['DRIVER', 'ADMIN'], ['ADMIN', 'SUPER_ADMIN'])).toBe(true);
    expect(hasAnyRole(['CUSTOMER'], ['ADMIN', 'SUPER_ADMIN'])).toBe(false);
  });
});
