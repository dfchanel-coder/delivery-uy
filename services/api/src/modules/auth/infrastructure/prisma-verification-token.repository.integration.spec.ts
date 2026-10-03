/**
 * `PrismaVerificationTokenRepository` against a real PostgreSQL.
 *
 * Two guarantees are only provable here. The single-use claim is a conditional
 * `updateMany`, so two simultaneous redemptions must not both win. And the type
 * is part of the lookup, which is a SQL predicate and not something a
 * TypeScript annotation can enforce.
 *
 * Skipped when no migrated database is reachable.
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
import { PrismaVerificationTokenRepository } from './prisma-verification-token.repository.js';

const PLACEHOLDER_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const seedUser = (client: PrismaClient): Promise<string> =>
  client.user
    .create({
      data: {
        email: `verify-${randomUUID()}@example.com`,
        passwordHash: PLACEHOLDER_HASH,
        status: 'PENDING_VERIFICATION' as never,
        roles: { create: [{ role: 'CUSTOMER' as never }] },
      },
      select: { id: true },
    })
    .then((created) => created.id);

describe('PrismaVerificationTokenRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAuthTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('stores the hash and the address the code proves', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'a'.repeat(64);
      const now = new Date();

      const created = await repository.create({
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash,
        destination: 'new-address@example.com',
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      expect(created.usedAt).toBeNull();

      const row = await client.verificationToken.findUniqueOrThrow({ where: { id: created.id } });

      // The destination is the address the code proves, not the account's
      // current one. Reading it back from the row is what stops a message about
      // one address from activating another.
      expect(row.destination).toBe('new-address@example.com');
      expect(row.tokenHash).toBe(tokenHash);
      // The plaintext only reaches the customer through the notifier port.
      expect(row).not.toHaveProperty('token');
    });
  });

  it('redeems a live code exactly once', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'b'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash,
        destination: 'person@example.com',
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      expect(
        (await repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now }))?.userId,
      ).toBe(userId);
      expect(await repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now })).toBeNull();
    });
  });

  it('lets only one of two simultaneous redemptions win', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'c'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash,
        destination: 'person@example.com',
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      const results = await Promise.all([
        repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now }),
        repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now }),
      ]);

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      expect(
        await client.verificationToken.count({ where: { tokenHash, usedAt: { not: null } } }),
      ).toBe(1);
    });
  });

  it('refuses a code presented under a different purpose', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'd'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash,
        destination: 'person@example.com',
        expiresAt: new Date(now.getTime() + 3_600_000),
        now,
      });

      // Both kinds are opaque values hashed into the same table. Without the type
      // in the WHERE clause a code issued to change an address would also confirm
      // an address, which is a different promise to a different recipient.
      expect(await repository.consumeByHash({ tokenHash, type: 'EMAIL_CHANGE', now })).toBeNull();

      // And the wrong attempt did not burn the real one.
      expect(
        await repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now }),
      ).not.toBeNull();
    });
  });

  it('refuses an expired code without marking it used', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const userId = await seedUser(client);
      const tokenHash = 'e'.repeat(64);
      const now = new Date();

      await repository.create({
        userId,
        type: 'EMAIL_VERIFY',
        tokenHash,
        destination: 'person@example.com',
        expiresAt: new Date(now.getTime() + 1_000),
        now,
      });

      const later = new Date(now.getTime() + 60_000);

      expect(
        await repository.consumeByHash({ tokenHash, type: 'EMAIL_VERIFY', now: later }),
      ).toBeNull();
      expect(
        (await client.verificationToken.findUniqueOrThrow({ where: { tokenHash } })).usedAt,
      ).toBeNull();
    });
  });

  it('invalidates only the requested kind, only for one account', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaVerificationTokenRepository(client);
      const mine = await seedUser(client);
      const theirs = await seedUser(client);
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3_600_000);

      const ownVerify = await repository.create({
        userId: mine,
        type: 'EMAIL_VERIFY',
        tokenHash: 'f'.repeat(64),
        destination: 'person@example.com',
        expiresAt,
        now,
      });
      await repository.create({
        userId: mine,
        type: 'EMAIL_CHANGE',
        tokenHash: '1'.repeat(64),
        destination: 'other@example.com',
        expiresAt,
        now,
      });
      await repository.create({
        userId: theirs,
        type: 'EMAIL_VERIFY',
        tokenHash: '2'.repeat(64),
        destination: 'third@example.com',
        expiresAt,
        now,
      });

      // Re-issuing a verification must not silently invalidate a pending address
      // change, and must not touch another account.
      expect(await repository.invalidateForUser({ userId: mine, type: 'EMAIL_VERIFY', now })).toBe(
        1,
      );
      expect(
        await repository.consumeByHash({ tokenHash: '1'.repeat(64), type: 'EMAIL_CHANGE', now }),
      ).not.toBeNull();
      expect(
        await repository.consumeByHash({ tokenHash: '2'.repeat(64), type: 'EMAIL_VERIFY', now }),
      ).not.toBeNull();
      expect(
        (await client.verificationToken.findUniqueOrThrow({ where: { id: ownVerify.id } })).usedAt,
      ).not.toBeNull();
      expect(
        await repository.consumeByHash({ tokenHash: 'f'.repeat(64), type: 'EMAIL_VERIFY', now }),
      ).toBeNull();
    });
  });
});
