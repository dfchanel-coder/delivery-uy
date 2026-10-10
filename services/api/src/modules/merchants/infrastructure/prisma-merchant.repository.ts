import { Inject, Injectable } from '@nestjs/common';
import { MerchantMemberRole, MerchantStatus, Prisma, PrismaClient } from '@deliveryuy/database';
import type { TransactionContext } from '../../../common/database/unit-of-work.js';
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
} from '../ports.js';

/** The `Merchant` row as Prisma returns it, before it becomes a domain record. */
type MerchantRow = Awaited<ReturnType<PrismaClient['merchant']['create']>>;

/**
 * Merchants, backed by PostgreSQL.
 *
 * Two writes that must not be split - a business and its owner membership - are
 * done on the caller's transaction client. `createWithOwner` never opens its own
 * transaction: the service already wraps onboarding (create + role grant + audit)
 * and nesting would commit the inner one independently.
 */
@Injectable()
export class PrismaMerchantRepository implements MerchantRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async createWithOwner(
    input: RegisterMerchantInput,
    tx: TransactionContext,
  ): Promise<MerchantRecord> {
    try {
      const merchant = await tx.merchant.create({
        data: {
          ownerUserId: input.ownerUserId,
          cityId: input.cityId,
          tradeName: input.tradeName,
          legalName: input.legalName,
          rut: input.rut,
          rutNormalized: input.rutNormalized,
          description: input.description,
          phoneE164: input.phoneE164,
          email: input.email,
          addressLine: input.addressLine,
          latitude: input.latitude,
          longitude: input.longitude,
          timezone: input.timezone,
          createdAt: input.now,
        },
      });

      await tx.merchantMember.create({
        data: {
          merchantId: merchant.id,
          userId: input.ownerUserId,
          role: MerchantMemberRole.OWNER,
        },
      });

      return toRecord(merchant);
    } catch (error) {
      throw translateRutConflict(error, input.rutNormalized);
    }
  }

  public async findByRutNormalized(rutNormalized: string): Promise<MerchantRecord | null> {
    const merchant = await this.prisma.merchant.findFirst({
      where: { rutNormalized, deletedAt: null },
    });

    return merchant === null ? null : toRecord(merchant);
  }

  public async findById(id: string): Promise<MerchantRecord | null> {
    const merchant = await this.prisma.merchant.findFirst({ where: { id, deletedAt: null } });

    return merchant === null ? null : toRecord(merchant);
  }

  public async listByMember(userId: string): Promise<readonly MerchantSummaryRecord[]> {
    const memberships = await this.prisma.merchantMember.findMany({
      where: { userId, merchant: { deletedAt: null } },
      include: { merchant: true },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((membership) => toSummary(membership.merchant));
  }

  public async findMembership(
    merchantId: string,
    userId: string,
  ): Promise<MerchantMembershipRecord | null> {
    const membership = await this.prisma.merchantMember.findUnique({
      where: { merchantId_userId: { merchantId, userId } },
    });

    if (membership === null) return null;

    return { merchantId: membership.merchantId, userId: membership.userId, role: membership.role };
  }

  public async updateProfile(
    id: string,
    patch: MerchantProfilePatch,
    tx?: TransactionContext,
  ): Promise<MerchantRecord> {
    const client = tx ?? this.prisma;

    const merchant = await client.merchant.update({
      where: { id },
      data: {
        ...(patch.tradeName !== undefined ? { tradeName: patch.tradeName } : {}),
        ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.phoneE164 !== undefined ? { phoneE164: patch.phoneE164 } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.addressLine !== undefined ? { addressLine: patch.addressLine } : {}),
        ...(patch.latitude !== undefined ? { latitude: patch.latitude } : {}),
        ...(patch.longitude !== undefined ? { longitude: patch.longitude } : {}),
      },
    });

    return toRecord(merchant);
  }

  public async approve(
    id: string,
    input: { approvedAt: Date; approvedByUserId: string },
    tx?: TransactionContext,
  ): Promise<MerchantRecord> {
    const client = tx ?? this.prisma;

    const merchant = await client.merchant.update({
      where: { id },
      data: {
        status: MerchantStatus.ACTIVE,
        approvedAt: input.approvedAt,
        approvedByUserId: input.approvedByUserId,
        rejectionReason: null,
      },
    });

    return toRecord(merchant);
  }

  public async reject(
    id: string,
    input: { rejectionReason: string },
    tx?: TransactionContext,
  ): Promise<MerchantRecord> {
    const client = tx ?? this.prisma;

    const merchant = await client.merchant.update({
      where: { id },
      data: {
        status: MerchantStatus.REJECTED,
        rejectionReason: input.rejectionReason,
        approvedAt: null,
        approvedByUserId: null,
      },
    });

    return toRecord(merchant);
  }

  public async listForAdmin(query: MerchantAdminQuery): Promise<MerchantAdminPage> {
    const where: Prisma.MerchantWhereInput = {
      deletedAt: null,
      ...(query.status !== undefined ? { status: query.status } : {}),
    };

    const [rows, totalCount] = await this.prisma.$transaction([
      this.prisma.merchant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.merchant.count({ where }),
    ]);

    return { data: rows.map(toSummary), totalCount };
  }
}

function translateRutConflict(error: unknown, rutNormalized: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new MerchantRutConflictError(rutNormalized);
  }

  return error;
}

function toRecord(merchant: MerchantRow): MerchantRecord {
  return {
    id: merchant.id,
    ownerUserId: merchant.ownerUserId,
    cityId: merchant.cityId,
    tradeName: merchant.tradeName,
    legalName: merchant.legalName,
    rut: merchant.rut,
    rutNormalized: merchant.rutNormalized,
    description: merchant.description,
    status: merchant.status,
    phoneE164: merchant.phoneE164,
    email: merchant.email,
    addressLine: merchant.addressLine,
    latitude: merchant.latitude.toFixed(6),
    longitude: merchant.longitude.toFixed(6),
    timezone: merchant.timezone,
    acceptingOrders: merchant.acceptingOrders,
    temporarilyClosedUntil: merchant.temporarilyClosedUntil,
    approvedAt: merchant.approvedAt,
    approvedByUserId: merchant.approvedByUserId,
    rejectionReason: merchant.rejectionReason,
    createdAt: merchant.createdAt,
    updatedAt: merchant.updatedAt,
  };
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
