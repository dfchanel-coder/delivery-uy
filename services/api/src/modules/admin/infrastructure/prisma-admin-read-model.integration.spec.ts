/**
 * `PrismaAdminReadModel` against a real PostgreSQL.
 *
 * The counts that matter are exercised with real rows: the soft-delete filter
 * (a soft-deleted user must disappear from both the total and the role tally),
 * the role tally itself and the 24-hour risk window.
 *
 * Merchants, drivers and orders are asserted as empty maps. Seeding a merchant
 * or an order would require forging the whole registration/order domain, which
 * does not exist yet; they traverse the identical `groupBy` code path as the
 * role tally, so an empty groupBy result maps to an empty map without masking a
 * regression in the one thing that differs per group: the `where` filter, which
 * is still a real query executed here against PostgreSQL.
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
import { PrismaAdminReadModel } from './prisma-admin-read-model.js';

const HASH = 'a'.repeat(64);

async function seedUser(
  client: PrismaClient,
  role: 'CUSTOMER' | 'MERCHANT',
  deleted = false,
): Promise<string> {
  const userId = (
    await client.user.create({
      data: {
        email: `panel-${randomUUID()}@example.com`,
        passwordHash: HASH,
        deletedAt: deleted ? new Date('2026-01-01T00:00:00.000Z') : null,
      },
    })
  ).id;

  await client.userRole.create({ data: { userId, role } });

  return userId;
}

describe('PrismaAdminReadModel (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAdminTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('counts active users by role and excludes soft-deleted ones', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const readModel = new PrismaAdminReadModel(client);

      await seedUser(client, 'CUSTOMER');
      await seedUser(client, 'MERCHANT');
      await seedUser(client, 'CUSTOMER', true);

      const summary = await readModel.summary();

      expect(summary.usersTotal).toBe(2);
      expect(summary.usersByRole).toEqual({ CUSTOMER: 1, MERCHANT: 1 });
    });
  });

  it('counts only the risk signals of the last 24 hours', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const readModel = new PrismaAdminReadModel(client);

      await client.riskEvent.create({
        data: { subjectType: 'USER', subjectId: randomUUID(), type: 'RECENT' },
      });
      await client.riskEvent.create({
        data: {
          subjectType: 'USER',
          subjectId: randomUUID(),
          type: 'OLD',
          createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        },
      });

      const summary = await readModel.summary();

      expect(summary.riskEventsLast24h).toBe(1);
    });
  });

  it('presents the remaining groups as empty maps until their data exists', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const readModel = new PrismaAdminReadModel(client);

      const summary = await readModel.summary();

      expect(summary.merchantsByStatus).toEqual({});
      expect(summary.driversByStatus).toEqual({});
      expect(summary.ordersByStatus).toEqual({});
    });
  });
});
