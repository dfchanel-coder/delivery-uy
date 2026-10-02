/**
 * `PrismaSessionRepository` against a real PostgreSQL.
 *
 * The rotation claim is the part a double cannot cover: it is a conditional
 * `updateMany` inside a transaction, so what matters is what PostgreSQL stores
 * when two clients refresh at the same instant. Skipped when no migrated
 * database is reachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import {
  closeDatabase,
  openDatabase,
  resetAuthTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { PrismaSessionRepository } from './prisma-session.repository.js';

const PLACEHOLDER_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const seedUser = (client: PrismaClient): Promise<string> =>
  client.user
    .create({
      data: {
        email: `session-${randomUUID()}@example.com`,
        passwordHash: PLACEHOLDER_HASH,
        status: 'ACTIVE' as never,
        roles: { create: [{ role: 'CUSTOMER' as never }] },
      },
      select: { id: true },
    })
    .then((created) => created.id);

const newSession = (userId: string, familyId: string, hash: string) => ({
  userId,
  familyId,
  refreshTokenHash: hash,
  expiresAt: new Date(Date.now() + 30 * 86_400_000),
  userAgent: 'vitest',
  ipAddress: '127.0.0.1',
  now: new Date(),
});

describe('PrismaSessionRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAuthTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('stores only the supplied hash', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const hash = 'a'.repeat(64);

      const created = await repository.create(newSession(userId, randomUUID(), hash));

      expect(created.refreshTokenHash).toBe(hash);
      expect(created.revokedAt).toBeNull();
      expect(created.rotatedAt).toBeNull();

      const row = await client.session.findUniqueOrThrow({ where: { id: created.id } });

      // A refresh token is opaque; storing anything other than its digest would
      // turn a database dump into a set of live sessions.
      expect(row.refreshTokenHash).toHaveLength(64);
    });
  });

  it('looks a session up by its hash and by its identifier', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const hash = 'b'.repeat(64);
      const created = await repository.create(newSession(userId, randomUUID(), hash));

      expect((await repository.findByRefreshTokenHash(hash))?.id).toBe(created.id);
      expect((await repository.findById(created.id))?.id).toBe(created.id);
      expect(await repository.findByRefreshTokenHash('z'.repeat(64))).toBeNull();
    });
  });

  it('rotates a session once and links the replacement both ways', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const familyId = randomUUID();
      const original = await repository.create(newSession(userId, familyId, 'c'.repeat(64)));
      const now = new Date();

      const outcome = await repository.rotate({
        sessionId: original.id,
        replacement: newSession(userId, familyId, 'd'.repeat(64)),
        now,
      });

      expect('reuseDetected' in outcome).toBe(false);

      if ('reuseDetected' in outcome) return;

      const consumed = await client.session.findUniqueOrThrow({ where: { id: original.id } });
      const replacement = await client.session.findUniqueOrThrow({
        where: { id: outcome.rotated.id },
      });

      expect(consumed.rotatedAt?.toISOString()).toBe(now.toISOString());
      expect(consumed.revokedReason).toBe('ROTATED');
      expect(consumed.replacedById).toBe(replacement.id);
      expect(replacement.revokedAt).toBeNull();
      expect(replacement.familyId).toBe(familyId);
    });
  });

  it('lets only one of two simultaneous rotations win', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const familyId = randomUUID();
      const original = await repository.create(newSession(userId, familyId, 'e'.repeat(64)));
      const now = new Date();

      const outcomes = await Promise.all([
        repository.rotate({
          sessionId: original.id,
          replacement: newSession(userId, familyId, 'f'.repeat(64)),
          now,
        }),
        repository.rotate({
          sessionId: original.id,
          replacement: newSession(userId, familyId, '0'.repeat(64)),
          now,
        }),
      ]);

      // This is the property a double cannot prove: the conditional claim makes
      // the second refresh fail at the database level, not by a check-then-write
      // race that merely happens to be fast enough in one process.
      expect(outcomes.filter((outcome) => 'reuseDetected' in outcome)).toHaveLength(1);
      expect(outcomes.filter((outcome) => !('reuseDetected' in outcome))).toHaveLength(1);

      expect(await client.session.count({ where: { familyId, revokedAt: null } })).toBe(1);
    });
  });

  it('rolls the transaction back so a losing rotation creates nothing', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const familyId = randomUUID();
      const original = await repository.create(newSession(userId, familyId, '1'.repeat(64)));
      const now = new Date();

      await repository.rotate({
        sessionId: original.id,
        replacement: newSession(userId, familyId, '2'.repeat(64)),
        now,
      });

      const before = await client.session.count({ where: { familyId } });

      const second = await repository.rotate({
        sessionId: original.id,
        replacement: newSession(userId, familyId, '3'.repeat(64)),
        now,
      });

      expect('reuseDetected' in second).toBe(true);
      // The replacement row is created after the claim, so a failure must undo
      // it rather than leave an orphaned live session behind.
      expect(await client.session.count({ where: { familyId } })).toBe(before);
    });
  });

  it('reports reuse when rotating an already revoked session', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const familyId = randomUUID();
      const original = await repository.create(newSession(userId, familyId, '4'.repeat(64)));

      await repository.revoke({ sessionId: original.id, now: new Date(), reason: 'USER_LOGOUT' });

      const outcome = await repository.rotate({
        sessionId: original.id,
        replacement: newSession(userId, familyId, '5'.repeat(64)),
        now: new Date(),
      });

      expect('reuseDetected' in outcome).toBe(true);
    });
  });

  it('revokes a whole family so a replayed token keeps no live session', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const familyId = randomUUID();

      await repository.create(newSession(userId, familyId, '6'.repeat(64)));
      const second = await repository.create(newSession(userId, familyId, '7'.repeat(64)));
      const now = new Date();

      expect(await repository.revokeFamily({ familyId, now, reason: 'REUSE_DETECTED' })).toBe(2);
      expect(await client.session.count({ where: { familyId, revokedAt: null } })).toBe(0);

      const stored = await client.session.findUniqueOrThrow({ where: { id: second.id } });

      expect(stored.revokedReason).toBe('REUSE_DETECTED');
      expect(stored.revokedAt?.toISOString()).toBe(now.toISOString());
    });
  });

  it('revokes every live session of a user but counts each row once', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);

      await repository.create(newSession(userId, randomUUID(), '8'.repeat(64)));
      await repository.create(newSession(userId, randomUUID(), '9'.repeat(64)));
      const alreadyRevoked = await repository.create(
        newSession(userId, randomUUID(), 'a'.repeat(64)),
      );

      await repository.revoke({
        sessionId: alreadyRevoked.id,
        now: new Date(),
        reason: 'USER_LOGOUT',
      });

      expect(
        await repository.revokeAllForUser({ userId, now: new Date(), reason: 'PASSWORD_RESET' }),
      ).toBe(2);
      expect(await client.session.count({ where: { userId, revokedAt: null } })).toBe(0);
    });
  });

  it('records the last use without reopening a revoked session', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaSessionRepository(client);
      const userId = await seedUser(client);
      const created = await repository.create(newSession(userId, randomUUID(), 'b'.repeat(64)));

      await repository.revoke({ sessionId: created.id, now: new Date(), reason: 'USER_LOGOUT' });

      const now = new Date();

      await repository.touch({ sessionId: created.id, now });

      const stored = await client.session.findUniqueOrThrow({ where: { id: created.id } });

      expect(stored.lastUsedAt?.toISOString()).toBe(now.toISOString());
      expect(stored.revokedAt).not.toBeNull();
    });
  });
});
