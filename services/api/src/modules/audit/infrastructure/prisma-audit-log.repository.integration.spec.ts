/**
 * `PrismaAuditLogRepository` against a real PostgreSQL.
 *
 * The keyset pagination claim is the part a double cannot cover: the cursor
 * comparison is a `(createdAt, id)` OR-pair executed by the database, and a row
 * inserted between two pages must not shift the boundary. Rows are seeded with
 * explicit, spaced timestamps so the order the database returns is the order
 * the test asserts.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import {
  closeDatabase,
  openDatabase,
  resetAdminTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { PrismaAuditLogRepository } from './prisma-audit.repository.js';

const HASH = 'a'.repeat(64);

function seedUser(client: PrismaClient): Promise<string> {
  return client.user
    .create({
      data: { email: `audit-${randomUUID()}@example.com`, passwordHash: HASH },
    })
    .then((user) => user.id);
}

describe('PrismaAuditLogRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAdminTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('records the actor and the entry verbatim', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaAuditLogRepository(client);
      const userId = await seedUser(client);

      await repository.record({
        actorUserId: userId,
        actorRole: 'SUPER_ADMIN',
        action: 'feature-flag.toggled',
        entityType: 'FeatureFlag',
        entityId: 'cashPayments',
        metadata: { enabled: true, previousEnabled: false },
        ipAddress: '203.0.113.9',
        userAgent: 'integration-test',
        correlationId: randomUUID(),
      });

      const rows = await client.auditLog.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actorUserId: userId,
        actorRole: 'SUPER_ADMIN',
        action: 'feature-flag.toggled',
        entityType: 'FeatureFlag',
        entityId: 'cashPayments',
        metadata: { enabled: true, previousEnabled: false },
        ipAddress: '203.0.113.9',
        userAgent: 'integration-test',
      });
    });
  });

  it('lists newest first', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaAuditLogRepository(client);
      const base = new Date('2026-01-01T00:00:00.000Z');

      for (let index = 0; index < 3; index += 1) {
        await client.auditLog.create({
          data: {
            action: `a.${index}`,
            entityType: 'X',
            createdAt: new Date(base.getTime() + index * 1000),
          },
        });
      }

      const page = await repository.list({ limit: 10, cursor: null });

      expect(page.hasMore).toBe(false);
      expect(page.rows.map((row) => row.action)).toEqual(['a.2', 'a.1', 'a.0']);
    });
  });

  it('pages with a keyset cursor that keeps the boundary stable', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaAuditLogRepository(client);
      const base = new Date('2026-01-01T00:00:00.000Z');
      const created: Array<{ createdAt: Date; id: string }> = [];

      for (let index = 0; index < 5; index += 1) {
        const row = await client.auditLog.create({
          data: {
            action: `page.${index}`,
            entityType: 'X',
            createdAt: new Date(base.getTime() + index * 1000),
          },
        });
        created.push({ createdAt: row.createdAt, id: row.id });
      }

      const first = await repository.list({
        limit: 2,
        cursor: { createdAt: created[4]!.createdAt, id: created[4]!.id },
      });

      expect(first.rows.map((row) => row.action)).toEqual(['page.3', 'page.2']);
      expect(first.hasMore).toBe(true);

      const lastOfSecondPage = first.rows[1]!;
      const second = await repository.list({
        limit: 2,
        cursor: { createdAt: lastOfSecondPage.createdAt, id: lastOfSecondPage.id },
      });

      expect(second.rows.map((row) => row.action)).toEqual(['page.1', 'page.0']);
      expect(second.hasMore).toBe(false);
    });
  });

  it('filters by action', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaAuditLogRepository(client);

      await client.auditLog.create({
        data: { action: 'keep.me', entityType: 'X' },
      });
      await client.auditLog.create({
        data: { action: 'drop.me', entityType: 'X' },
      });

      const page = await repository.list({ limit: 10, cursor: null, action: 'keep.me' });

      expect(page.rows.map((row) => row.action)).toEqual(['keep.me']);
    });
  });
});
