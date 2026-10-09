/**
 * The feature-flag toggle as one unit of work, against a real PostgreSQL.
 *
 * A double can prove that `AdminService` calls `runInTransaction`, but only the
 * database can prove the transaction really rolls back. That is the whole point
 * of the change: a failure after the flag update must leave the flag untouched,
 * so a changed flag can no longer exist with no record of who changed it
 * (AGENTS.md section 83).
 *
 * The rollback case is written against the repository directly. If
 * `PrismaFeatureFlagRepository.setEnabled` ignored the transaction handle and
 * used its own client, the update would commit and the assertion would fail -
 * which is exactly the bug this spec exists to catch.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import { PrismaUnitOfWork } from '../../common/database/prisma-unit-of-work.js';
import {
  closeDatabase,
  openDatabase,
  resetAdminTables,
  withDatabase,
} from '../../testing/infrastructure.js';
import { emptyPanelSummary, StubAdminReadModel } from '../../testing/admin-doubles.js';
import type { AuditActor } from '../audit/audit.ports.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/prisma-audit.repository.js';
import { PrismaRiskEventReader } from '../audit/infrastructure/prisma-risk-event-reader.repository.js';
import { PlatformService } from '../platform/platform.service.js';
import { PrismaFeatureFlagRepository } from '../platform/infrastructure/prisma-feature-flag.repository.js';
import { AdminService, FEATURE_FLAG_TOGGLED_ACTION } from './admin.service.js';

const PASSWORD_HASH = 'a'.repeat(64);
const FLAG_KEY = 'cashPayments';

/** A user row is required because `audit_logs.actor_user_id` is a foreign key. */
async function seedUser(client: PrismaClient): Promise<string> {
  const user = await client.user.create({
    data: { email: `admin-${randomUUID()}@example.com`, passwordHash: PASSWORD_HASH },
  });

  return user.id;
}

function actorFor(userId: string): AuditActor {
  return {
    userId,
    role: 'SUPER_ADMIN',
    ipAddress: '203.0.113.9',
    userAgent: 'integration-test',
    correlationId: randomUUID(),
  };
}

function buildService(client: PrismaClient): AdminService {
  return new AdminService(
    new StubAdminReadModel(emptyPanelSummary()),
    new PrismaUnitOfWork(client),
    new AuditService(new PrismaAuditLogRepository(client), new PrismaRiskEventReader(client)),
    new PlatformService(new PrismaFeatureFlagRepository(client)),
  );
}

describe('AdminService feature-flag toggle (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAdminTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('commits the flag change and its audit entry together', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const userId = await seedUser(client);
      await client.featureFlag.create({ data: { key: FLAG_KEY, enabled: false } });

      const result = await buildService(client).setFeatureFlagEnabled(
        actorFor(userId),
        FLAG_KEY,
        true,
      );

      expect(result.enabled).toBe(true);

      const flag = await client.featureFlag.findUnique({ where: { key: FLAG_KEY } });
      expect(flag?.enabled).toBe(true);
      expect(flag?.updatedByUserId).toBe(userId);

      const logs = await client.auditLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        actorUserId: userId,
        actorRole: 'SUPER_ADMIN',
        action: FEATURE_FLAG_TOGGLED_ACTION,
        entityType: 'FeatureFlag',
        entityId: FLAG_KEY,
        metadata: { enabled: true, previousEnabled: false },
      });
    });
  });

  it('rolls the flag back when the transaction fails after the update', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      await client.featureFlag.create({ data: { key: FLAG_KEY, enabled: false } });

      const unitOfWork = new PrismaUnitOfWork(client);
      const flags = new PrismaFeatureFlagRepository(client);

      await expect(
        unitOfWork.runInTransaction(async (tx) => {
          await flags.setEnabled(FLAG_KEY, true, null, tx);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      const flag = await client.featureFlag.findUnique({ where: { key: FLAG_KEY } });
      expect(flag?.enabled).toBe(false);
    });
  });

  it('writes no audit entry when the flag does not exist', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const userId = await seedUser(client);

      await expect(
        buildService(client).setFeatureFlagEnabled(actorFor(userId), 'missing.flag', true),
      ).rejects.toThrow();

      expect(await client.auditLog.count()).toBe(0);
    });
  });
});
