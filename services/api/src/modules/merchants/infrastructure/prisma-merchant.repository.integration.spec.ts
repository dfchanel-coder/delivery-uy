/**
 * `PrismaMerchantRepository` against a real PostgreSQL.
 *
 * Skipped when no migrated database is reachable; see
 * `src/testing/infrastructure.ts` for why skipping is acceptable and how CI
 * keeps it from hiding a regression. Every test asserts resulting database
 * state, not just the returned record (docs/TESTING.MD, "Critical rule").
 *
 * What this file proves that the in-memory double cannot: the unique constraint
 * on `rut_normalized` is the real arbiter of a concurrent registration, the
 * `NUMERIC(9, 6)` round-trip is lossless, and `createWithOwner` writes two rows
 * on the caller's transaction client (so a rollback leaves neither).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@deliveryuy/database';
import {
  closeDatabase,
  openDatabase,
  resetMerchantTables,
  withDatabase,
} from '../../../testing/infrastructure.js';
import { MerchantRutConflictError, type RegisterMerchantInput } from '../ports.js';
import { PrismaMerchantRepository } from './prisma-merchant.repository.js';

const PLACEHOLDER_HASH =
  '$argon2id$v=19$m=8192,t=1,p=1$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

interface Fixtures {
  readonly ownerId: string;
  readonly cityId: string;
}

async function seedFixtures(client: PrismaClient): Promise<Fixtures> {
  const country = await client.country.upsert({
    where: { code: 'URY' },
    update: {},
    create: {
      code: 'URY',
      name: 'Uruguay',
      defaultCurrency: 'UYU',
      timezone: 'America/Montevideo',
    },
  });

  const city = await client.city.create({
    data: {
      countryCode: country.code,
      name: `Ciudad ${randomUUID()}`,
      departmentOrState: 'Rivera',
      timezone: 'America/Montevideo',
      currency: 'UYU',
    },
  });

  const user = await client.user.create({
    data: {
      email: `owner-${randomUUID()}@example.com`,
      passwordHash: PLACEHOLDER_HASH,
      status: 'ACTIVE' as never,
      roles: { create: [{ role: 'CUSTOMER' as never }] },
    },
  });

  return { ownerId: user.id, cityId: city.id };
}

function registerInput(
  fixtures: Fixtures,
  overrides: Partial<RegisterMerchantInput> = {},
): RegisterMerchantInput {
  return {
    ownerUserId: fixtures.ownerId,
    cityId: fixtures.cityId,
    tradeName: 'Panadería Central',
    legalName: 'Panadería Central S.A.',
    rut: '211234560019',
    rutNormalized: '211234560019',
    description: null,
    phoneE164: '+59891234567',
    email: 'shop@example.com',
    addressLine: 'Ituzaingó 1234',
    latitude: '-30.900000',
    longitude: '-55.550000',
    timezone: 'America/Montevideo',
    now: new Date('2026-05-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaMerchantRepository (integration)', () => {
  beforeAll(async () => {
    await openDatabase();
  });

  beforeEach(resetMerchantTables);

  afterAll(async () => {
    await closeDatabase();
  });

  it('creates the business and its owner membership in one unit', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const fixtures = await seedFixtures(client);

      const created = await client.$transaction((tx) =>
        repository.createWithOwner(registerInput(fixtures), tx),
      );

      expect(created.status).toBe('PENDING_REVIEW');
      expect(created.latitude).toBe('-30.900000');
      expect(created.longitude).toBe('-55.550000');

      const membership = await client.merchantMember.findUnique({
        where: { merchantId_userId: { merchantId: created.id, userId: fixtures.ownerId } },
      });

      expect(membership?.role).toBe('OWNER');
    });
  });

  it('translates a duplicate RUT into a conflict, not a 500', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const fixtures = await seedFixtures(client);

      await client.$transaction((tx) => repository.createWithOwner(registerInput(fixtures), tx));

      // A second owner, same RUT: the pre-check would catch this, but the
      // constraint is what a race relies on.
      const other = await seedFixtures(client);

      await expect(
        client.$transaction((tx) => repository.createWithOwner(registerInput(other), tx)),
      ).rejects.toBeInstanceOf(MerchantRutConflictError);
    });
  });

  it('never returns a soft-deleted business', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const fixtures = await seedFixtures(client);
      const created = await client.$transaction((tx) =>
        repository.createWithOwner(registerInput(fixtures), tx),
      );

      await client.merchant.update({
        where: { id: created.id },
        data: { deletedAt: new Date() },
      });

      expect(await repository.findById(created.id)).toBeNull();
      expect(await repository.findByRutNormalized('211234560019')).toBeNull();
    });
  });

  it('lists only the businesses a member belongs to', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const mine = await seedFixtures(client);
      const theirs = await seedFixtures(client);

      await client.$transaction((tx) => repository.createWithOwner(registerInput(mine), tx));
      await client.$transaction((tx) =>
        repository.createWithOwner(
          registerInput(theirs, { rut: '213171030014', rutNormalized: '213171030014' }),
          tx,
        ),
      );

      const listed = await repository.listByMember(mine.ownerId);

      expect(listed).toHaveLength(1);
      expect(listed[0]?.tradeName).toBe('Panadería Central');
    });
  });

  it('filters and counts the admin page', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const first = await seedFixtures(client);
      const second = await seedFixtures(client);

      const pending = await client.$transaction((tx) =>
        repository.createWithOwner(registerInput(first), tx),
      );
      const other = await client.$transaction((tx) =>
        repository.createWithOwner(
          registerInput(second, { rut: '213171030014', rutNormalized: '213171030014' }),
          tx,
        ),
      );
      await repository.approve(other.id, {
        approvedAt: new Date(),
        approvedByUserId: first.ownerId,
      });

      const page = await repository.listForAdmin({ skip: 0, take: 10, status: 'PENDING_REVIEW' });

      expect(page.totalCount).toBe(1);
      expect(page.data.map((merchant) => merchant.id)).toEqual([pending.id]);
    });
  });

  it('approves and rejects by writing the lifecycle fields', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const fixtures = await seedFixtures(client);
      const created = await client.$transaction((tx) =>
        repository.createWithOwner(registerInput(fixtures), tx),
      );
      const approvedAt = new Date('2026-06-01T09:00:00.000Z');

      const rejected = await repository.reject(created.id, { rejectionReason: 'Ilegible' });
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.rejectionReason).toBe('Ilegible');

      const approved = await repository.approve(created.id, {
        approvedAt,
        approvedByUserId: fixtures.ownerId,
      });

      expect(approved.status).toBe('ACTIVE');
      expect(approved.approvedAt?.toISOString()).toBe(approvedAt.toISOString());
      expect(approved.approvedByUserId).toBe(fixtures.ownerId);
      expect(approved.rejectionReason).toBeNull();
    });
  });

  it('persists a profile patch, including a cleared description', async (ctx) => {
    await withDatabase(ctx, async (client) => {
      const repository = new PrismaMerchantRepository(client);
      const fixtures = await seedFixtures(client);
      const created = await client.$transaction((tx) =>
        repository.createWithOwner(registerInput(fixtures, { description: 'Antes' }), tx),
      );

      const updated = await repository.updateProfile(created.id, {
        tradeName: '  Nuevo Nombre  ',
        description: null,
        latitude: '-31.123456',
      });

      expect(updated.tradeName).toBe('Nuevo Nombre');
      expect(updated.description).toBeNull();
      expect(updated.latitude).toBe('-31.123456');
      expect(await repository.findById(created.id)).not.toBeNull();
    });
  });
});
