import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@deliveryuy/database';
import type {
  AuditLogQuery,
  AuditLogRecord,
  AuditLogRepository,
  NewAuditLogInput,
  RepositoryPage,
} from '../audit.ports.js';
import { asMetadata } from './json.js';

/**
 * Audit records, backed by PostgreSQL.
 *
 * Kept out of the controllers (docs/MODULE_BOUNDARIES.md) and behind the port,
 * so the service that decides what to record does not know how it is stored.
 *
 * Reads page by keyset, never by offset: `orderBy` and the cursor comparison use
 * the same `(createdAt, id)` key, so a row inserted between two requests cannot
 * shift a page (AGENTS.md section 55).
 */
@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async record(input: NewAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        actorRole: input.actorRole === null ? null : (input.actorRole as never),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        // Prisma's JSON input is narrower than `Record<string, unknown>`; the
        // value is already JSON-serialisable by the time it reaches here.
        metadata: input.metadata === null ? undefined : (input.metadata as never),
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        correlationId: input.correlationId,
        createdAt: new Date(),
      },
    });
  }

  public async list(query: AuditLogQuery): Promise<RepositoryPage<AuditLogRecord>> {
    const where: Prisma.AuditLogWhereInput = {};

    if (query.action !== undefined) where.action = query.action;
    if (query.cursor !== null) {
      where.OR = [
        { createdAt: { lt: query.cursor.createdAt } },
        { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
      ];
    }

    // One extra row tells the caller whether another page exists without a
    // second `count` query.
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    return {
      hasMore: rows.length > query.limit,
      rows: rows.slice(0, query.limit).map((row): AuditLogRecord => ({
        id: row.id,
        actorUserId: row.actorUserId,
        actorRole: row.actorRole,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: asMetadata(row.metadata),
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        correlationId: row.correlationId,
        createdAt: row.createdAt,
      })),
    };
  }
}
