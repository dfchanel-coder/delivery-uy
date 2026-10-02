import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type { PasswordResetTokenRecord, PasswordResetTokenRepository } from '../ports.js';

function toRecord(row: {
  id: string;
  userId: string;
  expiresAt: Date;
  usedAt: Date | null;
}): PasswordResetTokenRecord {
  return { id: row.id, userId: row.userId, expiresAt: row.expiresAt, usedAt: row.usedAt };
}

/**
 * Password recovery tokens, backed by PostgreSQL.
 *
 * Only the SHA-256 hash of the token is stored, exactly like a refresh token, so
 * neither a database dump nor a log line can be turned into a working reset link.
 */
@Injectable()
export class PrismaPasswordResetTokenRepository implements PasswordResetTokenRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(input: {
    userId: string;
    tokenHash: string;
    requestedIp: string | null;
    expiresAt: Date;
    now: Date;
  }): Promise<PasswordResetTokenRecord> {
    const created = await this.prisma.passwordResetToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        requestedIp: input.requestedIp,
        expiresAt: input.expiresAt,
        createdAt: input.now,
      },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    return toRecord(created);
  }

  /**
   * Consumes a token.
   *
   * A conditional update, not a read followed by a write: two concurrent resets
   * with the same link would otherwise both pass the `used_at IS NULL` check and
   * the second password would silently overwrite the first.
   */
  public async consumeByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<PasswordResetTokenRecord | null> {
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: {
        tokenHash: input.tokenHash,
        usedAt: null,
        expiresAt: { gt: input.now },
      },
      data: { usedAt: input.now },
    });

    if (claimed.count !== 1) return null;

    const consumed = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: input.tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });

    return consumed === null ? null : toRecord(consumed);
  }

  public async invalidateAllForUser(userId: string, now: Date): Promise<number> {
    const result = await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });

    return result.count;
  }
}
