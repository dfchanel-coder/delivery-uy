/**
 * `PrismaRiskEventReader` against a real PostgreSQL.
 *
 * The reader is the review side of the neutral risk signals: it must return the
 * rows some other module recorded, in the same keyset order the audit trail
 * uses, without ever writing. Filtering by signal type is what an
 * investigation needs, and paging must survive concurrent writes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  openDatabase,
  resetAdminTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { PrismaRiskEventReader } from './prisma-risk-event-reader.repository.js';

describe('PrismaRiskEventReader (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAdminTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('reads back the events other modules recorded', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const reader = new PrismaRiskEventReader(client);

      await client.riskEvent.create({
        data: {
          subjectType: 'USER',
          subjectId: randomUUID(),
          type: 'REFRESH_TOKEN_REUSE',
          severity: 'MEDIUM',
        },
      });

      const page = await reader.list({ limit: 10, cursor: null });

      expect(page.hasMore).toBe(false);
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]).toMatchObject({
        subjectType: 'USER',
        type: 'REFRESH_TOKEN_REUSE',
        severity: 'MEDIUM',
      });
    });
  });

  it('filters by type and pages newest first', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const reader = new PrismaRiskEventReader(client);
      const base = new Date('2026-01-01T00:00:00.000Z');

      await client.riskEvent.create({
        data: {
          subjectType: 'USER',
          subjectId: 'u-1',
          type: 'REFRESH_TOKEN_REUSE',
          severity: 'LOW',
          createdAt: new Date(base.getTime() + 2 * 1000),
        },
      });
      const filtered = await client.riskEvent.create({
        data: {
          subjectType: 'USER',
          subjectId: 'u-2',
          type: 'CHECKOUT_ANOMALY',
          severity: 'HIGH',
          createdAt: new Date(base.getTime() + 1 * 1000),
        },
      });

      const page = await reader.list({ limit: 10, cursor: null, type: 'CHECKOUT_ANOMALY' });

      expect(page.rows).toHaveLength(1);
      expect(page.rows[0]?.subjectId).toBe('u-2');

      const filteredPage = await reader.list({
        limit: 10,
        cursor: { createdAt: filtered.createdAt, id: filtered.id },
        type: 'CHECKOUT_ANOMALY',
      });

      expect(filteredPage.rows).toEqual([]);
      expect(filteredPage.hasMore).toBe(false);
    });
  });

  it('returns an empty continuation for a cursor past the end', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const reader = new PrismaRiskEventReader(client);

      const page = await reader.list({
        limit: 10,
        cursor: { createdAt: new Date('2030-01-01T00:00:00.000Z'), id: randomUUID() },
      });

      expect(page.rows).toEqual([]);
      expect(page.hasMore).toBe(false);
    });
  });
});
