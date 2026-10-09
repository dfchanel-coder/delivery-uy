import { randomUUID } from 'node:crypto';
import type { AdminPanelSummary } from '@deliveryuy/types';
import type { Cursor } from '../common/pagination/cursor.js';
import type { AdminReadModel } from '../modules/admin/admin.ports.js';
import type {
  AuditLogQuery,
  AuditLogRecord,
  AuditLogRepository,
  NewAuditLogInput,
  RepositoryPage,
  RiskEventQuery,
  RiskEventReader,
  RiskEventRecord,
} from '../modules/audit/audit.ports.js';
import type {
  FeatureFlagChange,
  FeatureFlagRecord,
  FeatureFlagRepository,
} from '../modules/platform/platform.ports.js';

/**
 * In-memory doubles for the admin, audit and platform ports.
 *
 * They exist so the services and the HTTP surface can be tested without
 * PostgreSQL (AGENTS.md section 5 allows mocks in tests). They are not a second
 * production implementation: the Prisma adapters in each module's
 * `infrastructure` directory are what runs, and the keyset paging here mirrors
 * the SQL - `(createdAt, id)` descending - so a test that pages correctly would
 * catch the two drifting apart.
 */

interface Sortable {
  readonly id: string;
  readonly createdAt: Date;
}

/** Newest first, then by id, matching the `orderBy` the adapters use. */
function compareNewestFirst(a: Sortable, b: Sortable): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();

  return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
}

/** True when `row` sorts after the cursor in descending order. */
function isBeforeCursor(row: Sortable, cursor: Cursor): boolean {
  const rowTime = row.createdAt.getTime();
  const cursorTime = cursor.createdAt.getTime();

  if (rowTime !== cursorTime) return rowTime < cursorTime;

  return row.id < cursor.id;
}

function paginate<Row extends Sortable>(
  rows: readonly Row[],
  limit: number,
  cursor: Cursor | null,
): RepositoryPage<Row> {
  const remaining = cursor === null ? [...rows] : rows.filter((row) => isBeforeCursor(row, cursor));
  const sorted = remaining.sort(compareNewestFirst);
  const window = sorted.slice(0, limit + 1);

  return { rows: window.slice(0, limit), hasMore: window.length > limit };
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  public readonly written: AuditLogRecord[] = [];
  private sequence = 0;

  public async record(input: NewAuditLogInput): Promise<void> {
    this.sequence += 1;
    this.written.push({
      id: randomUUID(),
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      correlationId: input.correlationId,
      // A strictly increasing timestamp keeps page ordering deterministic; two
      // entries written in the same millisecond would otherwise be ordered by a
      // random UUID and the paging assertions would flake.
      createdAt: new Date(Date.parse('2026-01-01T00:00:00.000Z') + this.sequence),
    });
  }

  public async list(query: AuditLogQuery): Promise<RepositoryPage<AuditLogRecord>> {
    const matching =
      query.action === undefined
        ? this.written
        : this.written.filter((row) => row.action === query.action);

    return paginate(matching, query.limit, query.cursor);
  }
}

export class InMemoryRiskEventReader implements RiskEventReader {
  public constructor(private readonly events: readonly RiskEventRecord[] = []) {}

  public async list(query: RiskEventQuery): Promise<RepositoryPage<RiskEventRecord>> {
    const matching =
      query.type === undefined ? this.events : this.events.filter((row) => row.type === query.type);

    return paginate(matching, query.limit, query.cursor);
  }
}

export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly flags = new Map<string, FeatureFlagRecord>();

  public seed(flag: FeatureFlagRecord): void {
    this.flags.set(flag.key, { ...flag });
  }

  public async list(): Promise<readonly FeatureFlagRecord[]> {
    return [...this.flags.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((flag) => ({ ...flag }));
  }

  public async setEnabled(key: string, enabled: boolean): Promise<FeatureFlagChange | null> {
    const before = this.flags.get(key);

    if (before === undefined) return null;

    const after: FeatureFlagRecord = {
      ...before,
      enabled,
      updatedAt: new Date(before.updatedAt.getTime() + 1000),
    };

    this.flags.set(key, after);

    return { before: { ...before }, after: { ...after } };
  }
}

export class StubAdminReadModel implements AdminReadModel {
  public constructor(private readonly value: AdminPanelSummary) {}

  public async summary(): Promise<AdminPanelSummary> {
    return this.value;
  }
}

export function emptyPanelSummary(): AdminPanelSummary {
  return {
    usersTotal: 0,
    usersByRole: {},
    merchantsByStatus: {},
    driversByStatus: {},
    ordersByStatus: {},
    riskEventsLast24h: 0,
  };
}
