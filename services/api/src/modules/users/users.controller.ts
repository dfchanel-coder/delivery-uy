import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { UsersService } from './users.service.js';
import { Permissions } from '../../common/security/endpoint-security.js';
import { UpdateUserStatusDto, UpdateUserRolesDto } from './dto/users.dto.js';
import type { UserListResponse, UserDetailResponse } from '@deliveryuy/types';

class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  public page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  public limit: number = 20;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Permissions('admin:users:read')
  public async listUsers(@Query() query: PaginationQueryDto): Promise<UserListResponse> {
    const { page, limit } = query;
    const result = await this.usersService.findMany(page, limit);

    const skip = (page - 1) * limit;

    return {
      data: result.data.map((user) => ({
        id: user.id,
        email: user.email,
        status: user.status,
        roles: user.roles,
        createdAt: user.createdAt.toISOString(),
      })),
      meta: {
        totalCount: result.totalCount,
        page,
        limit,
        hasNextPage: skip + limit < result.totalCount,
      },
    };
  }

  @Get(':id')
  @Permissions('admin:users:read')
  public async getUser(@Param('id') id: string): Promise<UserDetailResponse> {
    const user = await this.usersService.findById(id);

    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      status: user.status,
      roles: user.roles,
      locale: user.locale,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  @Patch(':id/status')
  @Permissions('admin:users:manage')
  public async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ): Promise<UserDetailResponse> {
    const user = await this.usersService.updateStatus(id, dto.status);

    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      status: user.status,
      roles: user.roles,
      locale: user.locale,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  @Patch(':id/roles')
  @Permissions('admin:users:manage')
  public async updateRoles(
    @Param('id') id: string,
    @Body() dto: UpdateUserRolesDto,
  ): Promise<UserDetailResponse> {
    const user = await this.usersService.updateRoles(id, dto.roles);

    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      status: user.status,
      roles: user.roles,
      locale: user.locale,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
