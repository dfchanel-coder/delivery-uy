import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type {
  VerificationTokenKind,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from '../ports.js';

function toRecord(row: {
  id: string;
  userId: string;
  destination: string;
  expiresAt: Date;
  usedAt: Date | null;
}): VerificationTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    destination: row.destination,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
  };
}

const SELECT = {
  id: true,
  userId: true,
  destination: true,
  expiresAt: true,
  usedAt: true,
} as const;

/**
 * Address verification tokens, backed by PostgreSQL.
 *
 * Only the SHA-256 hash is stored, the same property as a refresh token and a
 * recovery token: a dump of this table cannot produce a working link.
 *
 * The type is part of the lookup, not just a column. Without it a token issued
 * for one purpose would satisfy another, because both are opaque values hashed
 * into the same table.
 */
@Injectable()
export class PrismaVerificationTokenRepository implements VerificationTokenRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(input: {
    userId: string;
    type: VerificationTokenKind;
    tokenHash: string;
    destination: string;
    expiresAt: Date;
    now: Date;
  }): Promise<VerificationTokenRecord> {
    const created = await this.prisma.verificationToken.create({
      data: {
        userId: input.userId,
        type: input.type,
        tokenHash: input.tokenHash,
        destination: input.destination,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      },
      select: SELECT,
    });

    return toRecord(created);
  }

  /**
   * Consumes a token of one type.
   *
   * A conditional update, for the reason the recovery repository uses one: two
   * submissions of the same link would otherwise both observe `used_at IS NULL`
   * and both proceed.
   */
  public async consumeByHash(input: {
    tokenHash: string;
    type: VerificationTokenKind;
    now: Date;
  }): Promise<VerificationTokenRecord | null> {
    const claimed = await this.prisma.verificationToken.updateMany({
      where: {
        tokenHash: input.tokenHash,
        type: input.type,
        usedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { usedAt: input.now },
    });

    if (claimed.count !== 1) return null;

    const consumed = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: input.tokenHash },
      select: SELECT,
    });

    return consumed === null ? null : toRecord(consumed);
  }

  public async invalidateForUser(input: {
    userId: string;
    type: VerificationTokenKind;
    now: Date;
  }): Promise<number> {
    const result = await this.prisma.verificationToken.updateMany({
      where: { userId: input.userId, type: input.type, usedAt: null },
      data: { usedAt: input.now },
    });

    return result.count;
  }
}
