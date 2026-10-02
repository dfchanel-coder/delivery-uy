import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type { RiskEventInput, RiskEventRepository } from '../ports.js';

/**
 * Neutral risk signals, backed by PostgreSQL.
 *
 * A risk event is a fact ("this token was presented twice"), never a verdict.
 * Nothing here accuses a user of fraud: the event exists so an administrator can
 * look, and blocking decisions stay in explicit rules (AGENTS.md section 91).
 */
@Injectable()
export class PrismaRiskEventRepository implements RiskEventRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async record(input: RiskEventInput): Promise<void> {
    await this.prisma.riskEvent.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        type: input.type,
        severity: input.severity,
        metadata: input.metadata === undefined ? undefined : (input.metadata as never),
        createdAt: new Date(),
      },
    });
  }
}
