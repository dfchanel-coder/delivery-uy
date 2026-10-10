import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthenticatedUser } from '@deliveryuy/types';
import {
  InMemoryAuditLogRepository,
  InMemoryRiskEventReader,
  InMemoryUnitOfWork,
} from '../../testing/admin-doubles.js';
import {
  InMemoryCityRepository,
  InMemoryMerchantRepository,
} from '../../testing/merchant-doubles.js';
import type { AuditActor } from '../audit/audit.ports.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthService } from '../auth/auth.service.js';
import { GeoService } from '../geo/geo.service.js';
import { MerchantsService, type RegisterMerchantCommand } from './merchants.service.js';

/**
 * Merchant rules, without HTTP and without PostgreSQL.
 *
 * These cover what the double can prove: the check-digit RUT gate, one
 * membership per owner, membership before access, and the review state machine.
 * Atomicity is not provable here - the transaction integration spec is what
 * shows a failure rolls every write back.
 */

const ACTOR: AuditActor = {
  userId: 'user-1',
  role: 'CUSTOMER',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
  correlationId: 'corr-1',
};

/** The account state the fake repository answers `currentUser` with. */
class FakeAuth {
  public status: AuthenticatedUser['status'] = 'ACTIVE';
  public readonly granted: string[] = [];

  public async currentUser(userId: string): Promise<AuthenticatedUser> {
    return {
      id: userId,
      email: 'owner@example.com',
      status: this.status,
      roles: ['CUSTOMER'],
      locale: 'es',
    } as unknown as AuthenticatedUser;
  }

  public async grantMerchantRole(userId: string): Promise<void> {
    this.granted.push(userId);
  }
}

interface Harness {
  service: MerchantsService;
  merchants: InMemoryMerchantRepository;
  audits: InMemoryAuditLogRepository;
  unitOfWork: InMemoryUnitOfWork;
  auth: FakeAuth;
  cityId: string;
}

function buildHarness(): Harness {
  const merchants = new InMemoryMerchantRepository();
  const cities = new InMemoryCityRepository();
  const audits = new InMemoryAuditLogRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  const auth = new FakeAuth();
  const geo = new GeoService(cities);
  const audit = new AuditService(audits, new InMemoryRiskEventReader());
  const city = cities.seed();

  const service = new MerchantsService(
    merchants,
    unitOfWork,
    auth as unknown as AuthService,
    geo,
    audit,
  );

  return { service, merchants, audits, unitOfWork, auth, cityId: city.id };
}

const ENTRY: Omit<RegisterMerchantCommand, 'cityId'> = {
  tradeName: 'Panadería Central',
  legalName: 'Panadería Central S.A.',
  rut: '211234560019',
  phoneE164: '+59891234567',
  email: 'shop@example.com',
  addressLine: 'Ituzaingó 1234',
  latitude: -30.9,
  longitude: -55.550278,
};

let harness: Harness;

beforeEach(() => {
  harness = buildHarness();
});

function actions(): string[] {
  return harness.audits.written.map((entry) => entry.action);
}

describe('MerchantsService.register', () => {
  it('creates a pending business, makes the caller its owner and records the action', async () => {
    const merchant = await harness.service.register({ ...ENTRY, cityId: harness.cityId }, ACTOR);

    expect(merchant.status).toBe('PENDING_REVIEW');
    expect(merchant.ownerUserId).toBe(ACTOR.userId);
    expect(merchant.timezone).toBe('America/Montevideo');
    expect(merchant.latitude).toBe('-30.900000');

    const membership = await harness.merchants.findMembership(merchant.id, ACTOR.userId);
    expect(membership?.role).toBe('OWNER');

    expect(harness.auth.granted).toEqual([ACTOR.userId]);
    expect(actions()).toContain('merchant.registered');
    // Onboarding is one transaction: business, membership, role and audit.
    expect(harness.unitOfWork.transactions).toBe(1);
  });

  it('rejects a RUT whose check digit does not match, writing nothing', async () => {
    await expect(
      harness.service.register({ ...ENTRY, cityId: harness.cityId, rut: '211234560010' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(harness.auth.granted).toHaveLength(0);
    expect(harness.audits.written).toHaveLength(0);
  });

  it('rejects an unknown city', async () => {
    await expect(
      harness.service.register({ ...ENTRY, cityId: 'does-not-exist' }, ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('refuses an inactive account', async () => {
    harness.auth.status = 'SUSPENDED';

    await expect(
      harness.service.register({ ...ENTRY, cityId: harness.cityId }, ACTOR),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(harness.auth.granted).toHaveLength(0);
  });

  it('refuses a RUT already registered to another business', async () => {
    harness.merchants.seed({ rutNormalized: '211234560019', ownerUserId: 'someone-else' });

    await expect(
      harness.service.register({ ...ENTRY, cityId: harness.cityId }, ACTOR),
    ).rejects.toMatchObject({ code: 'MERCHANT_RUT_CONFLICT' });

    expect(harness.auth.granted).toHaveLength(0);
  });
});

describe('MerchantsService.listMine', () => {
  it('returns only the businesses the account belongs to, newest first', async () => {
    const older = harness.merchants.seed({
      ownerUserId: ACTOR.userId,
      tradeName: 'Old',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newer = harness.merchants.seed({
      ownerUserId: ACTOR.userId,
      tradeName: 'New',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    harness.merchants.seed({ ownerUserId: 'someone-else', tradeName: 'Other' });

    const mine = await harness.service.listMine(ACTOR.userId);

    expect(mine.map((merchant) => merchant.id)).toEqual([newer.id, older.id]);
  });
});

describe('MerchantsService.getForMember', () => {
  it('answers a business to a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: ACTOR.userId });

    await expect(harness.service.getForMember(merchant.id, ACTOR.userId)).resolves.toMatchObject({
      id: merchant.id,
    });
  });

  it('answers not-found to a caller that is not a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'someone-else' });

    await expect(harness.service.getForMember(merchant.id, ACTOR.userId)).rejects.toMatchObject({
      code: 'MERCHANT_NOT_FOUND',
    });
  });
});

describe('MerchantsService.updateProfile', () => {
  it('lets the owner update the trade name', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: ACTOR.userId });

    const updated = await harness.service.updateProfile(merchant.id, ACTOR.userId, {
      tradeName: '  Nuevo Nombre  ',
    });

    expect(updated.tradeName).toBe('Nuevo Nombre');
  });

  it('answers not-found to a caller that is not a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'someone-else' });

    await expect(
      harness.service.updateProfile(merchant.id, ACTOR.userId, { tradeName: 'X' }),
    ).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' });
  });

  it('refuses a member without an owner or manager role', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'someone-else' });
    harness.merchants.addMember(merchant.id, ACTOR.userId, 'CASHIER');

    await expect(
      harness.service.updateProfile(merchant.id, ACTOR.userId, { tradeName: 'X' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses to rewrite the legal name of an active business', async () => {
    const merchant = harness.merchants.seed({
      ownerUserId: ACTOR.userId,
      status: 'ACTIVE',
      legalName: 'Original S.A.',
    });

    await expect(
      harness.service.updateProfile(merchant.id, ACTOR.userId, { legalName: 'Otra S.A.' }),
    ).rejects.toMatchObject({ code: 'MERCHANT_INVALID_STATE' });
  });
});

describe('MerchantsService.approve', () => {
  it('moves a pending business to active and records the decision', async () => {
    const merchant = harness.merchants.seed({ status: 'PENDING_REVIEW' });

    const approved = await harness.service.approve(ACTOR, merchant.id);

    expect(approved.status).toBe('ACTIVE');
    expect(approved.approvedAt).not.toBeNull();
    expect(actions()).toContain('merchant.approved');
    expect(harness.unitOfWork.transactions).toBe(1);
  });

  it('refuses to approve a business that is already active', async () => {
    const merchant = harness.merchants.seed({ status: 'ACTIVE' });

    await expect(harness.service.approve(ACTOR, merchant.id)).rejects.toMatchObject({
      code: 'MERCHANT_INVALID_STATE',
    });
  });

  it('answers not-found for an unknown business', async () => {
    await expect(
      harness.service.approve(ACTOR, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ code: 'MERCHANT_NOT_FOUND' });
  });
});

describe('MerchantsService.reject', () => {
  it('moves a pending business to rejected and keeps the reason', async () => {
    const merchant = harness.merchants.seed({ status: 'PENDING_REVIEW' });

    const rejected = await harness.service.reject(ACTOR, merchant.id, '  Documentación ilegible  ');

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Documentación ilegible');
    expect(actions()).toContain('merchant.rejected');
  });

  it('lets a rejected business be approved after the documents are fixed', async () => {
    const merchant = harness.merchants.seed({ status: 'REJECTED' });

    const approved = await harness.service.approve(ACTOR, merchant.id);

    expect(approved.status).toBe('ACTIVE');
    expect(approved.rejectionReason).toBeNull();
  });
});

describe('MerchantsService.listForAdmin', () => {
  it('filters by status and counts only the matching rows', async () => {
    harness.merchants.seed({ status: 'PENDING_REVIEW' });
    harness.merchants.seed({ status: 'PENDING_REVIEW' });
    harness.merchants.seed({ status: 'ACTIVE' });

    const page = await harness.service.listForAdmin({
      page: 1,
      limit: 10,
      status: 'PENDING_REVIEW',
    });

    expect(page.data).toHaveLength(2);
    expect(page.totalCount).toBe(2);
    expect(page.data.every((merchant) => merchant.status === 'PENDING_REVIEW')).toBe(true);
  });
});
