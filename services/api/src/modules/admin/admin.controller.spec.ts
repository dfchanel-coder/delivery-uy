import { describe, expect, it } from 'vitest';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
} from '../../common/security/endpoint-security.js';
import { AdminController } from './admin.controller.js';

/**
 * The guard regression the earlier phases were missing: no admin route may be
 * public and every admin route must name the permission it requires.
 *
 * The decorators are metadata, not runtime checks - this test is what makes a
 * future route that forgets `@Permissions(...)` fail loudly instead of silently
 * giving every authenticated user access to a privileged action.
 *
 * Nest's `SetMetadata` stores the value on the method function itself
 * (`Reflect.defineMetadata(key, value, descriptor.value)`), so metadata is read
 * with the three-argument form, exactly as the guards read it off a handler.
 */

const ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  panel: ['admin:panel:read'],
  auditLogs: ['admin:audit:read'],
  riskEvents: ['admin:risk-events:read'],
  featureFlags: ['admin:panel:read'],
  setFeatureFlag: ['admin:feature-flags:write'],
};

function routeMethods(): string[] {
  return Object.getOwnPropertyNames(AdminController.prototype).filter(
    (name) => name !== 'constructor',
  );
}

function method(name: string): object {
  return (AdminController.prototype as unknown as Record<string, unknown>)[name] as object;
}

describe('AdminController security metadata', () => {
  it('declares exactly the documented routes', () => {
    expect(routeMethods().sort()).toEqual(Object.keys(ROUTE_PERMISSIONS).sort());
  });

  it('requires the exact documented permission on every route', () => {
    for (const [name, expected] of Object.entries(ROUTE_PERMISSIONS)) {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, method(name)),
        `route ${name} must carry @Permissions(...)`,
      ).toEqual(expected);
    }
  });

  it('exposes no admin route publicly', () => {
    for (const name of routeMethods()) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, method(name))).toBeUndefined();
    }
  });

  it('uses permissions instead of role metadata', () => {
    for (const name of routeMethods()) {
      expect(Reflect.getMetadata(ROLES_KEY, method(name))).toBeUndefined();
    }
  });
});
