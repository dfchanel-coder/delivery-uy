/**
 * `PrismaFeatureFlagRepository` against a real PostgreSQL.
 *
 * The semantics a double is most likely to fake are the ones tested here: the
 * previous value of a toggle must be what the database stored (not what the
 * caller hoped), the identity of who changed the flag must persist, and a key
 * nobody created must yield `null` instead of inventing a flag.
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
import { PrismaFeatureFlagRepository } from './prisma-feature-flag.repository.js';

async function seedFlag(
  client: PrismaClient,
  key: string,
  overrides: { enabled?: boolean; updatedByUserId?: string | null } = {},
): Promise<void> {
  await client.featureFlag.create({
    data: {
      key,
      scope: 'GLOBAL',
      enabled: overrides.enabled ?? false,
      updatedByUserId: overrides.updatedByUserId ?? null,
    },
  });
}

describe('PrismaFeatureFlagRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAdminTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('lists flags in key order', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaFeatureFlagRepository(client);
      await seedFlag(client, 'tips');
      await seedFlag(client, 'cashPayments');

      const flags = await repository.list();

      expect(flags.map((flag) => flag.key)).toEqual(['cashPayments', 'tips']);
    });
  });

  it('toggles a flag, persists the change and the identity of who changed it', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaFeatureFlagRepository(client);
      await seedFlag(client, 'cashPayments', { enabled: false });
      const changedBy = randomUUID();

      const change = await repository.setEnabled('cashPayments', true, changedBy);

      expect(change).not.toBeNull();
      expect(change!.before.enabled).toBe(false);
      expect(change!.after.enabled).toBe(true);
      expect(change!.after.rolloutPercentage).toBe(100);
      expect(change!.after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        change!.before.updatedAt.getTime(),
      );

      // The change must survive a new read, not just the returned view.
      const row = await client.featureFlag.findUniqueOrThrow({ where: { key: 'cashPayments' } });
      expect(row.enabled).toBe(true);
      expect(row.updatedByUserId).toBe(changedBy);
    });
  });

  it('does not invent a flag for a key nobody created', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaFeatureFlagRepository(client);

      const change = await repository.setEnabled('notAFlag', true, null);

      expect(change).toBeNull();
      expect(await client.featureFlag.count()).toBe(0);
    });
  });
});
