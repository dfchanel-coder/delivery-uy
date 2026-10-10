import { randomUUID } from 'node:crypto';
import type { MerchantMemberRole, MerchantStatus } from '@deliveryuy/database';
import type { GeoCityRecord, CityRepository } from '../modules/geo/ports.js';
import {
  MerchantRutConflictError,
  type MerchantAdminPage,
  type MerchantAdminQuery,
  type MerchantMembershipRecord,
  type MerchantProfilePatch,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantSummaryRecord,
  type RegisterMerchantInput,
} from '../modules/merchants/ports.js';

/** Strips `readonly` so the double can mutate what it stores. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * In-memory double for the merchant port.
 *
 * It exists so the merchant HTTP specs can exercise the guard chain, the global
 * pipes and the response envelope without PostgreSQL (AGENTS.md section 5
 * allows mocks in tests). It is not a second product implementation:
 * `PrismaMerchantRepository` is what runs in production and the integration
 * suite covers it. What the double reproduces faithfully is the behaviour the
 * rules depend on: the unique RUT, membership and the lifecycle fields.
 *
 * A soft-deleted merchant is simulated by deleting the map entry, since no spec
 * needs to observe the tombstone itself.
 */
export class InMemoryMerchantRepository implements MerchantRepository {
  private readonly merchants = new Map<string, Mutable<MerchantRecord>>();
  private readonly memberships = new Map<string, MerchantMembershipRecord>();

  /** Inserts a business with an `OWNER` membership, so a spec can arrange data. */
  public seed(overrides: Partial<MerchantRecord> = {}): MerchantRecord {
    const now = overrides.createdAt ?? new Date();

    const record: MerchantRecord = {
      id: overrides.id ?? randomUUID(),
      ownerUserId: overrides.ownerUserId ?? randomUUID(),
      cityId: overrides.cityId ?? randomUUID(),
      tradeName: overrides.tradeName ?? 'Seed Merchant',
      legalName: overrides.legalName ?? 'Seed Merchant S.A.',
      rut: overrides.rut ?? '213171030014',
      rutNormalized: overrides.rutNormalized ?? '213171030014',
      description: overrides.description ?? null,
      status: overrides.status ?? 'PENDING_REVIEW',
      phoneE164: overrides.phoneE164 ?? '+59891234567',
      email: overrides.email ?? 'merchant@example.com',
      addressLine: overrides.addressLine ?? 'Calle 1',
      latitude: overrides.latitude ?? '-30.905417',
      longitude: overrides.longitude ?? '-55.550278',
      timezone: overrides.timezone ?? 'America/Montevideo',
      acceptingOrders: overrides.acceptingOrders ?? false,
      temporarilyClosedUntil: overrides.temporarilyClosedUntil ?? null,
      approvedAt: overrides.approvedAt ?? null,
      approvedByUserId: overrides.approvedByUserId ?? null,
      rejectionReason: overrides.rejectionReason ?? null,
      createdAt: now,
      updatedAt: overrides.updatedAt ?? now,
    };

    this.merchants.set(record.id, { ...record });
    this.memberships.set(membershipKey(record.id, record.ownerUserId), {
      merchantId: record.id,
      userId: record.ownerUserId,
      role: 'OWNER',
    });

    return { ...record };
  }

  /** Test helper: adds a non-owner member so authorization paths can be exercised. */
  public addMember(merchantId: string, userId: string, role: MerchantMemberRole): void {
    this.memberships.set(membershipKey(merchantId, userId), { merchantId, userId, role });
  }

  public async createWithOwner(input: RegisterMerchantInput): Promise<MerchantRecord> {
    for (const existing of this.merchants.values()) {
      if (existing.rutNormalized === input.rutNormalized) {
        throw new MerchantRutConflictError(input.rutNormalized);
      }
    }

    const record: Mutable<MerchantRecord> = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      cityId: input.cityId,
      tradeName: input.tradeName,
      legalName: input.legalName,
      rut: input.rut,
      rutNormalized: input.rutNormalized,
      description: input.description,
      status: 'PENDING_REVIEW',
      phoneE164: input.phoneE164,
      email: input.email,
      addressLine: input.addressLine,
      latitude: input.latitude,
      longitude: input.longitude,
      timezone: input.timezone,
      acceptingOrders: false,
      temporarilyClosedUntil: null,
      approvedAt: null,
      approvedByUserId: null,
      rejectionReason: null,
      createdAt: input.now,
      updatedAt: input.now,
    };

    this.merchants.set(record.id, record);
    this.memberships.set(membershipKey(record.id, record.ownerUserId), {
      merchantId: record.id,
      userId: record.ownerUserId,
      role: 'OWNER',
    });

    return { ...record };
  }

  public async findByRutNormalized(rutNormalized: string): Promise<MerchantRecord | null> {
    for (const merchant of this.merchants.values()) {
      if (merchant.rutNormalized === rutNormalized) return { ...merchant };
    }

    return null;
  }

  public async findById(id: string): Promise<MerchantRecord | null> {
    const merchant = this.merchants.get(id);

    return merchant === undefined ? null : { ...merchant };
  }

  public async listByMember(userId: string): Promise<readonly MerchantSummaryRecord[]> {
    const owned = [...this.merchants.values()].filter((merchant) =>
      this.memberships.has(membershipKey(merchant.id, userId)),
    );

    return owned.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(toSummary);
  }

  public async findMembership(
    merchantId: string,
    userId: string,
  ): Promise<MerchantMembershipRecord | null> {
    return this.memberships.get(membershipKey(merchantId, userId)) ?? null;
  }

  public async updateProfile(id: string, patch: MerchantProfilePatch): Promise<MerchantRecord> {
    const merchant = this.require(id);
    Object.assign(merchant, patch, { updatedAt: new Date() });

    return { ...merchant };
  }

  public async approve(
    id: string,
    input: { approvedAt: Date; approvedByUserId: string },
  ): Promise<MerchantRecord> {
    const merchant = this.require(id);
    merchant.status = 'ACTIVE';
    merchant.approvedAt = input.approvedAt;
    merchant.approvedByUserId = input.approvedByUserId;
    merchant.rejectionReason = null;
    merchant.updatedAt = new Date();

    return { ...merchant };
  }

  public async reject(id: string, input: { rejectionReason: string }): Promise<MerchantRecord> {
    const merchant = this.require(id);
    merchant.status = 'REJECTED';
    merchant.rejectionReason = input.rejectionReason;
    merchant.approvedAt = null;
    merchant.approvedByUserId = null;
    merchant.updatedAt = new Date();

    return { ...merchant };
  }

  public async listForAdmin(query: MerchantAdminQuery): Promise<MerchantAdminPage> {
    const matching = [...this.merchants.values()]
      .filter((merchant) => query.status === undefined || merchant.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return {
      data: matching.slice(query.skip, query.skip + query.take).map(toSummary),
      totalCount: matching.length,
    };
  }

  private require(id: string): Mutable<MerchantRecord> {
    const merchant = this.merchants.get(id);

    if (merchant === undefined) throw new Error(`No merchant with id ${id} in the double.`);

    return merchant;
  }
}

/**
 * In-memory double for the city port.
 *
 * `geo`'s Prisma adapter is trivial, but `merchants` depends on its service, so
 * the merchant HTTP specs need a city that resolves without a database.
 */
export class InMemoryCityRepository implements CityRepository {
  private readonly cities = new Map<string, GeoCityRecord>();

  public seed(overrides: Partial<GeoCityRecord> = {}): GeoCityRecord {
    const city: GeoCityRecord = {
      id: overrides.id ?? randomUUID(),
      countryCode: overrides.countryCode ?? 'URY',
      name: overrides.name ?? 'Rivera',
      departmentOrState: overrides.departmentOrState ?? 'Rivera',
      timezone: overrides.timezone ?? 'America/Montevideo',
      currency: overrides.currency ?? 'UYU',
      isDefault: overrides.isDefault ?? false,
      enabled: overrides.enabled ?? true,
    };

    this.cities.set(city.id, city);

    return city;
  }

  public async findById(id: string): Promise<GeoCityRecord | null> {
    return this.cities.get(id) ?? null;
  }

  public async listEnabled(): Promise<readonly GeoCityRecord[]> {
    return [...this.cities.values()].filter((city) => city.enabled);
  }
}

function membershipKey(merchantId: string, userId: string): string {
  return `${merchantId}:${userId}`;
}

function toSummary(merchant: {
  id: string;
  tradeName: string;
  status: MerchantStatus;
  cityId: string;
  createdAt: Date;
}): MerchantSummaryRecord {
  return {
    id: merchant.id,
    tradeName: merchant.tradeName,
    status: merchant.status,
    cityId: merchant.cityId,
    createdAt: merchant.createdAt,
  };
}
