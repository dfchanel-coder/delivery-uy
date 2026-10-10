import { describe, expect, it } from 'vitest';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
} from '../../common/security/endpoint-security.js';
import { MerchantReviewController } from './merchant-review.controller.js';

/**
 * The review routes are privileged and live outside the `admin` module, so the
 * regression `admin.controller.spec.ts` applies to `admin` must apply here too:
 * no route may be public and every one must name `admin:merchants:review`.
 *
 * Without this, a future route added without `@Permissions(...)` would be
 * reachable by any authenticated merchant, which is exactly the mistake the
 * permission model exists to prevent (AGENTS.md sections 12, 32).
 */

const ROUTE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  list: ['admin:merchants:review'],
  get: ['admin:merchants:review'],
  approve: ['admin:merchants:review'],
  reject: ['admin:merchants:review'],
};

function routeMethods(): string[] {
  return Object.getOwnPropertyNames(MerchantReviewController.prototype).filter(
    (name) => name !== 'constructor',
  );
}

function method(name: string): object {
  return (MerchantReviewController.prototype as unknown as Record<string, unknown>)[name] as object;
}

describe('MerchantReviewController security metadata', () => {
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

  it('exposes no review route publicly', () => {
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
