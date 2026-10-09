import { Inject, Injectable } from '@nestjs/common';
import type { AdminAuditLog, AdminRiskEvent } from '@deliveryuy/types';
import { ApiException } from '../../common/errors/api-exception.js';
import { decodeCursor, encodeCursor, type Cursor } from '../../common/pagination/cursor.js';
import { PagedResult } from '../../common/pagination/paged-result.js';
import { AUDIT_LOG_REPOSITORY, RISK_EVENT_READER } from './audit.tokens.js';
import type {
  AuditActor,
  AuditLogRecord,
  AuditLogRepository,
  NewAuditLogInput,
  RiskEventReader,
  RiskEventRecord,
} from './audit.ports.js';

/** What a privileged action is being recorded as. */
export interface AuditEntry {
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface AuditLogListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly action?: string;
}

export interface RiskEventListQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly type?: string;
}

/**
 * Writes and reads the audit record (AGENTS.md sections 12, 29, 93).
 *
 * `record` is the only writer: every privileged action funnels through one
 * method, so "this action must be audited" is a property of the code path
 * rather than of each controller remembering to call Prisma.
 *
 * The record carries who acted, with which role, from which address, and under
 * which correlation id. It never carries a password, a token or card data; the
 * caller supplies `metadata` and is responsible for keeping those out, exactly
 * as AGENTS.md section 29 requires.
 */
@Injectable()
export class AuditService {
  public constructor(
    @Inject(AUDIT_LOG_REPOSITORY) private readonly logs: AuditLogRepository,
    @Inject(RISK_EVENT_READER) private readonly riskEvents: RiskEventReader,
  ) {}

  /** Records one privileged action. Awaited, so a failed write fails the request. */
  public async record(actor: AuditActor, entry: AuditEntry): Promise<void> {
    await this.logs.record(toInput(actor, entry));
  }

  public async listAuditLogs(query: AuditLogListQuery): Promise<PagedResult<AdminAuditLog>> {
    const page = await this.logs.list({
      limit: query.limit,
      cursor: resolveCursor(query.cursor),
      action: query.action,
    });

    return pageOf(page.rows, page.hasMore, toAuditLogView);
  }

  public async listRiskEvents(query: RiskEventListQuery): Promise<PagedResult<AdminRiskEvent>> {
    const page = await this.riskEvents.list({
      limit: query.limit,
      cursor: resolveCursor(query.cursor),
      type: query.type,
    });

    return pageOf(page.rows, page.hasMore, toRiskEventView);
  }
}

/**
 * A cursor a client cannot construct is reported as bad input.
 *
 * Ignoring it would silently restart the list at the newest row, which is how a
 * caller that meant to page forward ends up reprocessing the same page forever.
 */
function resolveCursor(value: string | undefined): Cursor | null {
  if (value === undefined) return null;

  const cursor = decodeCursor(value);

  if (cursor === null) {
    throw new ApiException('VALIDATION_FAILED', 'The cursor is not valid.');
  }

  return cursor;
}

/** Maps a repository page into the wire page, deriving the next cursor. */
function pageOf<Row extends { readonly id: string; readonly createdAt: Date }, View>(
  rows: readonly Row[],
  hasMore: boolean,
  map: (row: Row) => View,
): PagedResult<View> {
  const last = hasMore ? rows[rows.length - 1] : undefined;
  const nextCursor =
    last === undefined ? null : encodeCursor({ createdAt: last.createdAt, id: last.id });

  return new PagedResult(rows.map(map), nextCursor);
}

function toInput(actor: AuditActor, entry: AuditEntry): NewAuditLogInput {
  return {
    actorUserId: actor.userId,
    actorRole: actor.role,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    correlationId: actor.correlationId,
  };
}

function toAuditLogView(row: AuditLogRecord): AdminAuditLog {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    correlationId: row.correlationId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRiskEventView(row: RiskEventRecord): AdminRiskEvent {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    type: row.type,
    severity: row.severity,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}
