import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient, notDeleted } from '@deliveryuy/database';
import type { AdminPanelSummary } from '@deliveryuy/types';
import type { AdminReadModel } from '../admin.ports.js';

/** The panel counts, read from PostgreSQL with a handful of grouped queries. */
@Injectable()
export class PrismaAdminReadModel implements AdminReadModel {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public async summary(): Promise<AdminPanelSummary> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      usersTotal,
      usersByRole,
      merchantsByStatus,
      driversByStatus,
      ordersByStatus,
      riskEvents,
    ] = await Promise.all([
      // Soft-deleted rows are excluded everywhere a soft delete exists, so the
      // panel matches what an administrator sees in the corresponding list
      // (packages/database soft-delete catalogue).
      this.prisma.user.count({ where: notDeleted }),
      this.prisma.userRole.groupBy({
        by: ['role'],
        where: { user: notDeleted },
        _count: { _all: true },
      }),
      this.prisma.merchant.groupBy({
        by: ['status'],
        where: notDeleted,
        _count: { _all: true },
      }),
      this.prisma.driver.groupBy({
        by: ['status'],
        where: notDeleted,
        _count: { _all: true },
      }),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.riskEvent.count({ where: { createdAt: { gte: since } } }),
    ]);

    return {
      usersTotal,
      usersByRole: tally(usersByRole.map((row) => [row.role, row._count._all])),
      merchantsByStatus: tally(merchantsByStatus.map((row) => [row.status, row._count._all])),
      driversByStatus: tally(driversByStatus.map((row) => [row.status, row._count._all])),
      ordersByStatus: tally(ordersByStatus.map((row) => [row.status, row._count._all])),
      riskEventsLast24h: riskEvents,
    };
  }
}

/** Turns grouped rows into the plain map the response contract declares. */
function tally(
  entries: ReadonlyArray<readonly [string, number]>,
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};

  for (const [key, count] of entries) {
    result[key] = count;
  }

  return result;
}
