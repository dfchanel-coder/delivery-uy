import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
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
  ): Promise<FeatureFlagChange | null> {
    const before = await this.prisma.featureFlag.findUnique({ where: { key } });

    if (before === null) return null;

    const after = await this.prisma.featureFlag.update({
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
