import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@deliveryuy/database';
import type {
  RepositoryPage,
  RiskEventQuery,
  RiskEventReader,
  RiskEventRecord,
} from '../audit.ports.js';
import { asMetadata } from './json.js';

/**
 * Read side of the neutral risk signals (AGENTS.md section 91).
 *
 * The write side lives with the module that detects the signal (for example the
 * auth module records a replayed refresh token); this reader only lets an
 * administrator review what was recorded. It never writes, which is what keeps
 * `audit` a records-only module (docs/MODULE_BOUNDARIES.md).
 */
@Injectable()
export class PrismaRiskEventReader implements RiskEventReader {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async list(query: RiskEventQuery): Promise<RepositoryPage<RiskEventRecord>> {
    const where: Prisma.RiskEventWhereInput = {};

    if (query.type !== undefined) where.type = query.type;
    if (query.cursor !== null) {
      where.OR = [
        { createdAt: { lt: query.cursor.createdAt } },
        { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
      ];
    }

    const rows = await this.prisma.riskEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    return {
      hasMore: rows.length > query.limit,
      rows: rows.slice(0, query.limit).map((row): RiskEventRecord => ({
        id: row.id,
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        type: row.type,
        severity: row.severity,
        metadata: asMetadata(row.metadata),
        createdAt: row.createdAt,
      })),
    };
  }
}
