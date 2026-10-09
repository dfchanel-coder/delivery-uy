import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type { TransactionContext } from '../../../common/database/unit-of-work.js';
import type {
  FeatureFlagChange,
  FeatureFlagRecord,
  FeatureFlagRepository,
} from '../platform.ports.js';

/** Feature flags, backed by PostgreSQL. */
@Injectable()
export class PrismaFeatureFlagRepository implements FeatureFlagRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async list(): Promise<readonly FeatureFlagRecord[]> {
    const rows = await this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });

    return rows.map(toRecord);
  }

  public async setEnabled(
    key: string,
    enabled: boolean,
    updatedByUserId: string | null,
    tx?: TransactionContext,
  ): Promise<FeatureFlagChange | null> {
    // The read and the write share `db`, so a transaction sees a consistent
    // snapshot and both commit or roll back together (AGENTS.md section 83).
    const db = tx ?? this.prisma;

    const before = await db.featureFlag.findUnique({ where: { key } });

    if (before === null) return null;

    const after = await db.featureFlag.update({
      where: { key },
      data: { enabled, updatedByUserId },
    });

    return { before: toRecord(before), after: toRecord(after) };
  }
}

function toRecord(row: {
  key: string;
  scope: string;
  scopeRef: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  description: string | null;
  updatedAt: Date;
}): FeatureFlagRecord {
  return {
    key: row.key,
    scope: row.scope,
    scopeRef: row.scopeRef,
    enabled: row.enabled,
    rolloutPercentage: row.rolloutPercentage,
    description: row.description,
    updatedAt: row.updatedAt,
  };
}
