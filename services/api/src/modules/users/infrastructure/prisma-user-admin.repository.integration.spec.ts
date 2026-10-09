import { describe, expect, it, beforeEach } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import { PrismaUserAdminRepository } from './prisma-user-admin.repository.js';
import { withDatabase } from '../../../testing/infrastructure.js';

describe('PrismaUserAdminRepository (Integration)', () => {
  let client: PrismaClient;
  let repository: PrismaUserAdminRepository;

  beforeEach(async (ctx) => {
    await withDatabase(ctx, async (c) => {
      client = c;
      repository = new PrismaUserAdminRepository(client);
      await client.user.deleteMany({});
    });
  });

  const runIfReachable = it.runIf(process.env['DATABASE_URL'] !== undefined);

  runIfReachable('findMany pagination', async () => {
    // Create 3 users
    for (let i = 0; i < 3; i++) {
      await client.user.create({
        data: {
          email: `user${i}@test.com`,
          passwordHash: 'dummy',
          status: 'ACTIVE',
        },
      });
    }

    const page1 = await repository.findMany(0, 2);
    expect(page1.totalCount).toBe(3);
    expect(page1.data).toHaveLength(2);

    const page2 = await repository.findMany(2, 2);
    expect(page2.totalCount).toBe(3);
    expect(page2.data).toHaveLength(1);
  });

  runIfReachable('updateRoles sets and replaces roles', async () => {
    const user = await client.user.create({
      data: {
        email: 'roles@test.com',
        passwordHash: 'dummy',
        status: 'ACTIVE',
      },
    });

    const updated = await repository.updateRoles(user.id, ['CUSTOMER', 'MERCHANT']);
    expect([...updated.roles].sort()).toEqual(['CUSTOMER', 'MERCHANT']);

    const revoked = await repository.updateRoles(user.id, ['CUSTOMER']);
    expect(revoked.roles).toEqual(['CUSTOMER']);
  });

  runIfReachable('updateStatus changes the status', async () => {
    const user = await client.user.create({
      data: {
        email: 'status@test.com',
        passwordHash: 'dummy',
        status: 'ACTIVE',
      },
    });

    const suspended = await repository.updateStatus(user.id, 'SUSPENDED');
    expect(suspended.status).toBe('SUSPENDED');

    const dbUser = await client.user.findUnique({ where: { id: user.id } });
    expect(dbUser?.status).toBe('SUSPENDED');
  });

  runIfReachable('countSuperAdmins', async () => {
    await client.user.create({
      data: {
        email: 'admin1@test.com',
        passwordHash: 'dummy',
        status: 'ACTIVE',
        roles: { create: { role: 'SUPER_ADMIN' } },
      },
    });

    await client.user.create({
      data: {
        email: 'admin2@test.com',
        passwordHash: 'dummy',
        status: 'SUSPENDED', // Should not be counted if we enforce ACTIVE, but the repo only checks deletedAt: null currently
        roles: { create: { role: 'SUPER_ADMIN' } },
      },
    });

    const count = await repository.countSuperAdmins();
    // Repo counts all undeleted super admins
    expect(count).toBe(2);
  });
});
