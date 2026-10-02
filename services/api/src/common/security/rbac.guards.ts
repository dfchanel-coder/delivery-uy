import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { principalCan, principalHasAnyRole } from '@deliveryuy/auth';
import type { Permission, Role } from '@deliveryuy/auth';
import { ERROR_CODES } from '@deliveryuy/types';
import { ApiException } from '../errors/api-exception.js';
import { PERMISSIONS_KEY, principalOf, ROLES_KEY } from './endpoint-security.js';

/**
 * Role guard.
 *
 * Answers "is this one of these roles", which is what most role-protected
 * endpoints need. It runs after `JwtAuthGuard`, so a role check is only reached
 * with a verified principal.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) return true;

    const principal = principalOf(context);

    if (principalHasAnyRole(principal, required)) return true;

    throw new ApiException(
      ERROR_CODES.FORBIDDEN,
      'Your role does not grant access to this resource.',
      { requiredRoles: [...required] },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * Permission guard.
 *
 * Preferred over `RolesGuard` for privileged actions: the permission names the
 * capability, so adding an action cannot accidentally widen an existing role
 * (`ADMIN` is never implicitly a `SUPER_ADMIN`, AGENTS.md section 70).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<readonly Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required === undefined || required.length === 0) return true;

    const principal = principalOf(context);
    const granted = required.filter((permission) => principalCan(principal, permission));

    if (granted.length === required.length) return true;

    throw new ApiException(
      ERROR_CODES.FORBIDDEN,
      'Your role does not grant access to this resource.',
      { requiredPermissions: [...required] },
      HttpStatus.FORBIDDEN,
    );
  }
}
