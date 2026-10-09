import { describe, expect, it, beforeEach } from 'vitest';
import { UsersService } from './users.service.js';
import type { UserAdminRepository, UserAdminEntity, UserAdminPaginated } from './ports.js';
import { ApiException } from '../../common/errors/api-exception.js';
import type { AppRole, UserStatus } from '@deliveryuy/database';

class FakeUserRepository implements UserAdminRepository {
  public users = new Map<string, UserAdminEntity>();
  public async findMany(skip: number, take: number): Promise<UserAdminPaginated> {
    const data = Array.from(this.users.values())
      .slice(skip, skip + take)
      .map((u) => ({
        id: u.id,
        email: u.email,
        status: u.status,
        roles: u.roles,
        createdAt: u.createdAt,
      }));
    return { data, totalCount: this.users.size };
  }
  public async findById(id: string): Promise<UserAdminEntity | null> {
    return this.users.get(id) ?? null;
  }
  public async updateStatus(id: string, status: UserStatus): Promise<UserAdminEntity> {
    const user = this.users.get(id)!;
    const updated = { ...user, status };
    this.users.set(id, updated);
    return updated;
  }
  public async updateRoles(id: string, roles: readonly AppRole[]): Promise<UserAdminEntity> {
    const user = this.users.get(id)!;
    const updated = { ...user, roles };
    this.users.set(id, updated);
    return updated;
  }
  public async countSuperAdmins(): Promise<number> {
    return Array.from(this.users.values()).filter(
      (u) => u.roles.includes('SUPER_ADMIN') && u.status === 'ACTIVE',
    ).length;
  }
}

describe('UsersService', () => {
  let repository: FakeUserRepository;
  let service: UsersService;

  beforeEach(() => {
    repository = new FakeUserRepository();
    service = new UsersService(repository);
  });

  const createDummyUser = (
    id: string,
    roles: AppRole[],
    status: UserStatus = 'ACTIVE',
  ): UserAdminEntity => ({
    id,
    email: `${id}@test.com`,
    phoneE164: null,
    status,
    roles,
    locale: 'es',
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    mustChangePassword: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  describe('updateStatus', () => {
    it('suspends a normal user', async () => {
      repository.users.set('1', createDummyUser('1', ['CUSTOMER']));
      const result = await service.updateStatus('1', 'SUSPENDED');
      expect(result.status).toBe('SUSPENDED');
    });

    it('refuses to suspend the last SUPER_ADMIN', async () => {
      repository.users.set('1', createDummyUser('1', ['SUPER_ADMIN']));
      await expect(service.updateStatus('1', 'SUSPENDED')).rejects.toThrowError(ApiException);
    });

    it('allows suspending a SUPER_ADMIN if another is active', async () => {
      repository.users.set('1', createDummyUser('1', ['SUPER_ADMIN']));
      repository.users.set('2', createDummyUser('2', ['SUPER_ADMIN']));
      const result = await service.updateStatus('1', 'SUSPENDED');
      expect(result.status).toBe('SUSPENDED');
    });
  });

  describe('updateRoles', () => {
    it('updates roles for a normal user', async () => {
      repository.users.set('1', createDummyUser('1', ['CUSTOMER']));
      const result = await service.updateRoles('1', ['CUSTOMER', 'MERCHANT']);
      expect(result.roles).toEqual(['CUSTOMER', 'MERCHANT']);
    });

    it('refuses to revoke SUPER_ADMIN from the last SUPER_ADMIN', async () => {
      repository.users.set('1', createDummyUser('1', ['SUPER_ADMIN']));
      await expect(service.updateRoles('1', ['ADMIN'])).rejects.toThrowError(ApiException);
    });

    it('allows revoking SUPER_ADMIN if another is active', async () => {
      repository.users.set('1', createDummyUser('1', ['SUPER_ADMIN']));
      repository.users.set('2', createDummyUser('2', ['SUPER_ADMIN']));
      const result = await service.updateRoles('1', ['ADMIN']);
      expect(result.roles).toEqual(['ADMIN']);
    });
  });
});
