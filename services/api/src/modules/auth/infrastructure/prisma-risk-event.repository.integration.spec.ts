/**
 * `PrismaRiskEventRepository` against a real PostgreSQL.
 *
 * A risk event is a neutral fact, so what is asserted is that the row lands
 * verbatim in `risk_events` with its metadata intact, and that recording one
 * never changes anything about the subject it describes.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  openDatabase,
  resetAuthTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { PrismaRiskEventRepository } from './prisma-risk-event.repository.js';

describe('PrismaRiskEventRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAuthTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('records the event with its metadata', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaRiskEventRepository(client);
      const subjectId = randomUUID();

      await repository.record({
        subjectType: 'session',
        subjectId,
        type: 'refresh_token_reuse_detected',
        severity: 'HIGH',
        metadata: { familyId: randomUUID(), attempts: 2 },
      });

      const stored = await client.riskEvent.findFirstOrThrow({ where: { subjectId } });

      expect(stored.subjectType).toBe('session');
      expect(stored.type).toBe('refresh_token_reuse_detected');
      expect(stored.severity).toBe('HIGH');
      expect(stored.metadata).toMatchObject({ attempts: 2 });
      expect(stored.createdAt).toBeInstanceOf(Date);
    });
  });

  it('accepts an event without metadata', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaRiskEventRepository(client);
      const subjectId = randomUUID();

      await repository.record({
        subjectType: 'user',
        subjectId,
        type: 'password_reset_requested',
        severity: 'LOW',
      });

      const stored = await client.riskEvent.findFirstOrThrow({ where: { subjectId } });

      expect(stored.metadata).toBeNull();
    });
  });

  it('never modifies the subject it describes', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaRiskEventRepository(client);
      const user = await client.user.create({
        data: {
          email: `risk-${randomUUID()}@example.com`,
          passwordHash:
            '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          status: 'ACTIVE' as never,
          roles: { create: [{ role: 'CUSTOMER' as never }] },
        },
        select: { id: true, status: true },
      });

      await repository.record({
        subjectType: 'user',
        subjectId: user.id,
        type: 'account_locked_after_failed_logins',
        severity: 'MEDIUM',
      });

      // Recording an operational fact must not suspend or disable anybody:
      // blocking is an explicit administrative action (AGENTS.md section 91).
      const stored = await client.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(stored.status).toBe('ACTIVE');
    });
  });

  it('keeps events in order so an investigation can follow a sequence', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaRiskEventRepository(client);
      const subjectId = randomUUID();

      for (const type of ['first', 'second', 'third']) {
        await repository.record({ subjectType: 'user', subjectId, type, severity: 'LOW' });
      }

      const stored = await client.riskEvent.findMany({
        where: { subjectId },
        orderBy: { createdAt: 'asc' },
      });

      expect(stored.map((event) => event.type)).toEqual(['first', 'second', 'third']);
    });
  });
});
