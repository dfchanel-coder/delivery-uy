import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type {
  NewSession,
  SessionRecord,
  SessionRepository,
  SessionRevokeReason,
} from '../ports.js';

/**
 * Signals that a rotation lost the race against a concurrent refresh.
 *
 * Thrown inside the transaction to roll back the partially created replacement,
 * then translated into `{ reuseDetected: true }` by the adapter.
 */
class RotationConflict extends Error {
  public constructor() {
    super('session was already rotated or revoked');
    this.name = 'RotationConflict';
  }
}

function toSession(row: {
  id: string;
  userId: string;
  familyId: string;
  replacedById: string | null;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  rotatedAt: Date | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    familyId: row.familyId,
    replacedById: row.replacedById,
    refreshTokenHash: row.refreshTokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedReason: row.revokedReason,
    rotatedAt: row.rotatedAt,
  };
}

const SESSION_SELECT = {
  id: true,
  userId: true,
  familyId: true,
  replacedById: true,
  refreshTokenHash: true,
  expiresAt: true,
  revokedAt: true,
  revokedReason: true,
  rotatedAt: true,
} as const;

/**
 * Sessions, backed by PostgreSQL.
 *
 * Only the SHA-256 hash of a refresh token is stored, so a database leak does
 * not hand out live sessions (SECURITY.md "Password and Token Parameters").
 * Rotation is a single transaction: the row is claimed with a conditional update
 * before the replacement is created, which is what makes two simultaneous
 * refreshes impossible instead of merely unlikely.
 */
@Injectable()
export class PrismaSessionRepository implements SessionRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(input: NewSession): Promise<SessionRecord> {
    const created = await this.prisma.session.create({
      data: {
        userId: input.userId,
        familyId: input.familyId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        lastUsedAt: input.now,
        createdAt: input.now,
      },
      select: SESSION_SELECT,
    });

    return toSession(created);
  }

  public async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const found = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      select: SESSION_SELECT,
    });

    return found === null ? null : toSession(found);
  }

  public async findById(id: string): Promise<SessionRecord | null> {
    const found = await this.prisma.session.findUnique({
      where: { id },
      select: SESSION_SELECT,
    });

    return found === null ? null : toSession(found);
  }

  /**
   * Rotates a session inside one transaction.
   *
   * The claim is a conditional `updateMany` on `revoked_at IS NULL AND
   * rotated_at IS NULL`. Two concurrent refreshes therefore cannot both see a
   * free row: the second one matches zero rows, aborts, and is reported as
   * reuse so the family can be revoked.
   */
  public async rotate(input: {
    sessionId: string;
    replacement: NewSession;
    now: Date;
  }): Promise<{ rotated: SessionRecord } | { reuseDetected: true }> {
    try {
      const rotated = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.session.updateMany({
          where: { id: input.sessionId, revokedAt: null, rotatedAt: null },
          data: { rotatedAt: input.now, revokedAt: input.now, revokedReason: 'ROTATED' },
        });

        if (claimed.count !== 1) throw new RotationConflict();

        const replacement = await tx.session.create({
          data: {
            userId: input.replacement.userId,
            familyId: input.replacement.familyId,
            refreshTokenHash: input.replacement.refreshTokenHash,
            expiresAt: input.replacement.expiresAt,
            userAgent: input.replacement.userAgent,
            ipAddress: input.replacement.ipAddress,
            lastUsedAt: input.now,
            createdAt: input.now,
          },
          select: SESSION_SELECT,
        });

        await tx.session.update({
          where: { id: input.sessionId },
          data: { replacedById: replacement.id },
        });

        return replacement;
      });

      return { rotated: toSession(rotated) };
    } catch (error: unknown) {
      if (error instanceof RotationConflict) return { reuseDetected: true };
      throw error;
    }
  }

  public async revoke(input: {
    sessionId: string;
    now: Date;
    reason: SessionRevokeReason;
  }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: input.sessionId, revokedAt: null },
      data: { revokedAt: input.now, revokedReason: input.reason },
    });
  }

  /**
   * Revokes every live session of a family.
   *
   * Called when a rotated token is replayed. Revoking only the offending row
   * would leave the attacker's replacement session usable, so the whole family
   * goes down and the legitimate client has to sign in again.
   */
  public async revokeFamily(input: {
    familyId: string;
    now: Date;
    reason: SessionRevokeReason;
  }): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { familyId: input.familyId, revokedAt: null },
      data: { revokedAt: input.now, revokedReason: input.reason },
    });

    return result.count;
  }

  public async revokeAllForUser(input: {
    userId: string;
    now: Date;
    reason: SessionRevokeReason;
  }): Promise<number> {
    const result = await this.prisma.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: input.now, revokedReason: input.reason },
    });

    return result.count;
  }

  public async touch(input: { sessionId: string; now: Date }): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: input.sessionId },
      data: { lastUsedAt: input.now },
    });
  }
}
