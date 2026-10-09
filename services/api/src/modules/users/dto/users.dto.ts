import { ArrayNotEmpty, IsArray, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { AppRole, UserStatus } from '@deliveryuy/database';
import { ROLES } from '@deliveryuy/auth';

/**
 * Request DTOs for `/api/v1/users`.
 *
 * `class-validator` to match the global `ValidationPipe` (same as the auth
 * DTOs): with `whitelist` and `forbidNonWhitelisted`, a body must be decorated
 * here or every request is rejected.
 */

const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;

export class UpdateUserStatusDto {
  @ApiProperty({ enum: USER_STATUSES })
  @IsIn(USER_STATUSES)
  public status!: UserStatus;
}

export class UpdateUserRolesDto {
  @ApiProperty({ enum: ROLES, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(ROLES, { each: true })
  public roles!: AppRole[];
}
