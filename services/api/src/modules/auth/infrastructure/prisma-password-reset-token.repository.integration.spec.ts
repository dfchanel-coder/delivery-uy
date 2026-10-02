/**
 * `PrismaPasswordResetTokenRepository` against a real PostgreSQL.
 *
 * The single-use guarantee is a conditional `updateMany`, so it is only really
 * proven here: two concurrent redemptions of the same link must not both
 * succeed. Skipped when no migrated database is reachable.
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
import { PrismaPasswordResetTokenRepository } from './prisma-password-reset-token.repository.js';

const PLACEHOLDER_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const seedUser = (client: PrismaClient): Promise<string> =>
  client.user
    .create({
      data: {
        email: `reset-${randomUUID()}@example.com`,
        passwordHash: PLACEHOLDER_HASH,
        status: 'ACTIVE' as never,
        roles: { create: [{ role: 'CUSTOMER' as never }] },
      },
      select: { id: true },
    })
    .then((created) => created.id);

describe('PrismaPasswordResetTokenRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAuthTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('stores the hash and the requesting address', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'a'.repeat(64);
      const now = new Date();

      const created = await repository.create({
        userId,
        tokenHash,
        requestedIp: '203.0.113.7',
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      expect(created.usedAt).toBeNull();

      const row = await client.passwordResetToken.findUniqueOrThrow({ where: { id: created.id } });

      expect(row.tokenHash).toBe(tokenHash);
      expect(row.requestedIp).toBe('203.0.113.7');
      // The plaintext only reaches the customer through the notifier port; the
      // table must hold nothing that could be replayed from a dump.
      expect(row).not.toHaveProperty('token');
    });
  });

  it('redeems a live token exactly once', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'b'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        tokenHash,
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      expect((await repository.consumeByHash({ tokenHash, now }))?.userId).toBe(userId);
      expect(await repository.consumeByHash({ tokenHash, now })).toBeNull();
    });
  });

  it('lets only one of two simultaneous redemptions win', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'c'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        tokenHash,
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      const results = await Promise.all([
        repository.consumeByHash({ tokenHash, now }),
        repository.consumeByHash({ tokenHash, now }),
      ]);

      // Without the conditional update both reads would see `used_at IS NULL`
      // and the second reset would silently overwrite the first password.
      expect(results.filter((result) => result !== null)).toHaveLength(1);

      const used = await client.passwordResetToken.count({
        where: { tokenHash, usedAt: { not: null } },
      });

      expect(used).toBe(1);
    });
  });

  it('refuses an expired token without marking it used', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'd'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        tokenHash,
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 1_000),
        now,
      });

      const later = new Date(now.getTime() + 60_000);

      expect(await repository.consumeByHash({ tokenHash, now: later })).toBeNull();

      const stored = await client.passwordResetToken.findUniqueOrThrow({ where: { tokenHash } });

      expect(stored.usedAt).toBeNull();
    });
  });

  it('refuses an unknown token', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);

      expect(
        await repository.consumeByHash({ tokenHash: 'e'.repeat(64), now: new Date() }),
      ).toBeNull();
    });
  });

  it('invalidates every outstanding token of an account', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const userId = await seedUser(client);
      const now = new Date();

      await repository.create({
        userId,
        tokenHash: 'f'.repeat(64),
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      const spent = await repository.create({
        userId,
        tokenHash: '0'.repeat(64),
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      await repository.consumeByHash({ tokenHash: '0'.repeat(64), now });

      expect(await repository.invalidateAllForUser(userId, now)).toBe(1);
      expect(await repository.consumeByHash({ tokenHash: 'f'.repeat(64), now })).toBeNull();

      const stored = await client.passwordResetToken.findUniqueOrThrow({ where: { id: spent.id } });

      expect(stored.usedAt).not.toBeNull();
    });
  });

  it('does not touch another account when invalidating', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaPasswordResetTokenRepository(client);
      const mine = await seedUser(client);
      const theirs = await seedUser(client);
      const now = new Date();

      await repository.create({
        userId: mine,
        tokenHash: '1'.repeat(64),
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      await repository.create({
        userId: theirs,
        tokenHash: '2'.repeat(64),
        requestedIp: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      expect(await repository.invalidateAllForUser(mine, now)).toBe(1);
      expect(await repository.consumeByHash({ tokenHash: '2'.repeat(64), now })).not.toBeNull();
    });
  });
});
