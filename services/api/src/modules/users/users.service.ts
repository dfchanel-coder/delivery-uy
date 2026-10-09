import { Injectable, Inject } from '@nestjs/common';
import { USER_ADMIN_REPOSITORY } from './users.tokens.js';
import type { UserAdminRepository, UserAdminEntity, UserAdminPaginated } from './ports.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { ERROR_CODES } from '@deliveryuy/types';
import { AppRole, UserStatus } from '@deliveryuy/database';

@Injectable()
export class UsersService {
  constructor(
    @Inject(USER_ADMIN_REPOSITORY)
    private readonly repository: UserAdminRepository,
  ) {}

  public async findMany(page: number, limit: number): Promise<UserAdminPaginated> {
    const skip = (page - 1) * limit;
    return this.repository.findMany(skip, limit);
  }

  public async findById(id: string): Promise<UserAdminEntity> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, 'User not found.');
    }
    return user;
  }

  public async updateStatus(id: string, status: UserStatus): Promise<UserAdminEntity> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, 'User not found.');
    }

    if (user.roles.includes('SUPER_ADMIN') && status !== 'ACTIVE') {
      const superAdminCount = await this.repository.countSuperAdmins();
      if (superAdminCount <= 1) {
        throw new ApiException(
          ERROR_CODES.VALIDATION_FAILED,
          'Cannot suspend or disable the last active SUPER_ADMIN.',
        );
      }
    }

    return this.repository.updateStatus(id, status);
  }

  public async updateRoles(id: string, roles: readonly AppRole[]): Promise<UserAdminEntity> {
    const user = await this.repository.findById(id);
    if (!user) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, 'User not found.');
    }

    // If the user currently has SUPER_ADMIN and the new roles do not, ensure it's not the last one
    if (user.roles.includes('SUPER_ADMIN') && !roles.includes('SUPER_ADMIN')) {
      const superAdminCount = await this.repository.countSuperAdmins();
      if (superAdminCount <= 1) {
        throw new ApiException(
          ERROR_CODES.VALIDATION_FAILED,
          'Cannot revoke the SUPER_ADMIN role from the last active SUPER_ADMIN.',
        );
      }
    }

    return this.repository.updateRoles(id, roles);
  }
}
