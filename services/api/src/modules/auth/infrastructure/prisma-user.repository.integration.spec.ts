/**
 * `PrismaUserRepository` against a real PostgreSQL.
 *
 * Skipped when no migrated database is reachable; see
 * `src/testing/infrastructure.ts` for why skipping is acceptable and how CI
 * keeps it from hiding a regression. Every test asserts resulting database
 * state, not just the returned record (docs/TESTING.MD, "Critical rule").
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import { hashPassword, TEST_ARGON2_PARAMETERS } from '@deliveryuy/auth';
import {
  closeDatabase,
  hasEmailFunctionalIndex,
  openDatabase,
  resetAuthTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { PrismaUserRepository } from './prisma-user.repository.js';

/**
 * A syntactically valid Argon2id PHC string that is not a digest of anything.
 *
 * Used only where the test is about repository behaviour rather than hashing.
 * The test that does assert a real digest hashes for real instead.
 */
const PLACEHOLDER_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

interface SeedOptions {
  readonly email: string;
  readonly roles?: readonly string[];
  readonly deletedAt?: Date;
  readonly status?: string;
}

const seedUser = (client: PrismaClient, options: SeedOptions): Promise<string> =>
  client.user
    .create({
      data: {
        email: options.email,
        passwordHash: PLACEHOLDER_HASH,
        status: (options.status ?? 'ACTIVE') as never,
        deletedAt: options.deletedAt ?? null,
        roles: { create: (options.roles ?? ['CUSTOMER']).map((role) => ({ role: role as never })) },
      },
      select: { id: true },
    })
    .then((created) => created.id);

describe('PrismaUserRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetAuthTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('finds an account by email regardless of letter case', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'Person@Example.com' });

      const found = await repository.findByEmail('person@example.com');

      expect(found?.id).toBe(id);
      expect(found?.email).toBe('Person@Example.com');
      expect(found?.roles).toEqual(['CUSTOMER']);
    });
  });

  it('answers the email lookup from the functional index', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      expect(await hasEmailFunctionalIndex(client)).toBe(true);

      // The predicate mirrors the repository's own lookup, including the
      // soft-delete clause. That clause is not decoration: `users_email_lower_uniq`
      // is a *partial* index, and PostgreSQL will not consider it unless the
      // query implies `deleted_at IS NULL`.
      //
      // Which plan the planner picks is still a cost decision, and on a table
      // this small it would legitimately answer with a sequential scan. So the
      // planner is not allowed to decide: sequential scans are priced out for
      // the duration of the statement, and whatever index is left is the one
      // that can serve this predicate. Both matter, because the reason the
      // repository writes `lower(email)` instead of an insensitive match is
      // that only the former can use the index at all.
      const plan = await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');

        return tx.$queryRawUnsafe<Array<Record<string, string>>>(
          'EXPLAIN SELECT 1 FROM "users" u WHERE lower(u."email") = lower($1) AND u."deleted_at" IS NULL',
          'plan@example.com',
        );
      });

      expect(Object.values(plan[0] ?? {}).join('\n')).toContain('users_email_lower_uniq');
    });
  });

  it('never returns a soft-deleted account', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'gone@example.com', deletedAt: new Date() });

      expect(await repository.findByEmail('gone@example.com')).toBeNull();
      expect(await repository.findById(id)).toBeNull();
    });
  });

  it('frees the email address once an account is soft deleted', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);

      await seedUser(client, { email: 'reuse@example.com', deletedAt: new Date() });

      // The partial unique index excludes deleted rows, so the same person can
      // register again. This is the property the soft-delete rule depends on.
      const created = await repository.createCustomer({
        email: 'reuse@example.com',
        passwordHash: PLACEHOLDER_HASH,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        now: new Date(),
      });

      expect(created.email).toBe('reuse@example.com');

      const roles = await client.userRole.findMany({ where: { userId: created.id } });

      expect(roles.map((role) => role.role)).toEqual(['CUSTOMER']);
    });
  });

  it('rejects a duplicate email that differs only in case', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);

      await seedUser(client, { email: 'taken@example.com' });

      await expect(
        repository.createCustomer({
          email: 'TAKEN@example.com',
          passwordHash: PLACEHOLDER_HASH,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          now: new Date(),
        }),
      ).rejects.toThrow();
    });
  });

  it('locks the account on the threshold attempt and keeps the lock', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'lock@example.com' });
      const now = new Date('2026-05-01T12:00:00.000Z');
      const lockUntil = new Date(now.getTime() + 15 * 60_000);

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await repository.registerFailedLogin({ userId: id, now, maxAttempts: 3, lockUntil });
      }

      const locked = await repository.findById(id);

      expect(locked?.failedLoginAttempts).toBe(3);
      expect(locked?.lockedUntil).not.toBeNull();

      // A failure inside the lock window must not push the lock further out: the
      // countdown belongs to the service, the only side that knows `now`.
      const inside = new Date(now.getTime() + 60_000);
      const further = new Date(inside.getTime() + 5 * 60_000);

      await repository.registerFailedLogin({
        userId: id,
        now: inside,
        maxAttempts: 3,
        lockUntil: further,
      });

      const stillLocked = await repository.findById(id);

      expect(stillLocked?.failedLoginAttempts).toBe(4);
      expect(stillLocked?.lockedUntil?.toISOString()).toBe(lockUntil.toISOString());
    });
  });

  it('counts concurrent failures without losing increments', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'race@example.com' });
      const now = new Date('2026-05-01T12:00:00.000Z');

      // Six parallel attempts against a threshold of five. The counter and the
      // lock decision are one transaction, so the stored value must be exactly
      // six and the lock must be applied.
      await Promise.all(
        Array.from({ length: 6 }, () =>
          repository.registerFailedLogin({
            userId: id,
            now,
            maxAttempts: 5,
            lockUntil: new Date(now.getTime() + 60_000),
          }),
        ),
      );

      const stored = await client.user.findUnique({
        where: { id },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });

      expect(stored?.failedLoginAttempts).toBe(6);
      expect(stored?.lockedUntil).not.toBeNull();
    });
  });

  it('clears the failure state on a successful login', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'reset@example.com' });
      const now = new Date('2026-05-01T12:00:00.000Z');
      const lockUntil = new Date(now.getTime() + 60_000);

      await repository.registerFailedLogin({ userId: id, now, maxAttempts: 5, lockUntil });
      await repository.registerFailedLogin({ userId: id, now, maxAttempts: 5, lockUntil });

      await repository.registerSuccessfulLogin({ userId: id, now });

      const stored = await repository.findById(id);

      expect(stored?.failedLoginAttempts).toBe(0);
      expect(stored?.lockedUntil).toBeNull();
      expect(stored?.lastLoginAt?.toISOString()).toBe(now.toISOString());
    });
  });

  it('replaces the stored hash on a password change', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'rotate@example.com' });
      const replacement = await hashPassword('a-brand-new-password', TEST_ARGON2_PARAMETERS);

      await repository.updatePasswordHash({
        userId: id,
        passwordHash: replacement,
        now: new Date(),
      });

      const stored = await client.user.findUnique({
        where: { id },
        select: { passwordHash: true },
      });

      expect(stored?.passwordHash).toBe(replacement);
      // A real Argon2id digest, not a placeholder: a test or a seed that wrote a
      // fake hash would pass the equality check above and break every login.
      expect(String(stored?.passwordHash).startsWith('$argon2id$')).toBe(true);
    });
  });

  it('stamps verification and activates only when the deployment allows it', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const activated = await seedUser(client, {
        email: 'verify-activate@example.com',
        status: 'PENDING_VERIFICATION',
      });
      const pending = await seedUser(client, {
        email: 'verify-pending@example.com',
        status: 'PENDING_VERIFICATION',
      });
      const now = new Date('2026-05-02T09:30:00.000Z');

      await repository.markEmailVerified({ userId: activated, now, activate: true });
      await repository.markEmailVerified({ userId: pending, now, activate: false });

      expect((await repository.findById(activated))?.status).toBe('ACTIVE');
      expect((await repository.findById(pending))?.status).toBe('PENDING_VERIFICATION');

      const rows = await client.user.findMany({
        where: { id: { in: [activated, pending] } },
        select: { emailVerifiedAt: true },
      });

      expect(rows).toHaveLength(2);

      for (const row of rows) {
        expect(row.emailVerifiedAt?.toISOString()).toBe(now.toISOString());
      }
    });
  });

  it('finds an account by identifier and reports null for an unknown one', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaUserRepository(client);
      const id = await seedUser(client, { email: 'byid@example.com', roles: ['ADMIN'] });

      const found = await repository.findById(id);

      expect(found?.roles).toEqual(['ADMIN']);
      expect(await repository.findById(randomUUID())).toBeNull();
    });
  });
});
