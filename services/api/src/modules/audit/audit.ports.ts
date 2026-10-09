import type { Cursor } from '../../common/pagination/cursor.js';
import type { TransactionContext } from '../../common/database/unit-of-work.js';

/**
 * Audit persistence ports (docs/MODULE_BOUNDARIES.md: `audit` owns
 * `audit_logs` and `risk_events`).
 *
 * The application service depends on these interfaces rather than on Prisma, so
 * the rules that matter - what an audit entry records, and that an administrator
 * can only read one they are permitted to - are testable without a database.
 */

/**
 * Who performed a privileged action.
 *
 * `role` is the role the token carried at the time. Recording it is the point:
 * a later change to the permission matrix must not rewrite history, and reading
 * an old entry must show which role actually acted (AGENTS.md sections 20, 21).
 */
export interface AuditActor {
  readonly userId: string;
  readonly role: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string | null;
}

export interface NewAuditLogInput {
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string | null;
}

export interface AuditLogRecord {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string | null;
  readonly createdAt: Date;
}

export interface RiskEventRecord {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly type: string;
  readonly severity: string;
  readonly metadata: Record<string, unknown> | null;
  readonly createdAt: Date;
}

export interface AuditLogQuery {
  readonly limit: number;
  readonly cursor: Cursor | null;
  /** Restricts to one action when the caller is investigating a specific one. */
  readonly action?: string;
}

export interface RiskEventQuery {
  readonly limit: number;
  readonly cursor: Cursor | null;
  readonly type?: string;
}

/** A raw page: one extra row is requested to learn whether another page exists. */
export interface RepositoryPage<T> {
  readonly rows: readonly T[];
  readonly hasMore: boolean;
}

export interface AuditLogRepository {
  /**
   * Appends one audit entry.
   *
   * When `tx` is passed, the insert joins the caller's transaction, so a
   * privileged change and its audit record commit or roll back together
   * (AGENTS.md sections 29, 83).
   */
  record(input: NewAuditLogInput, tx?: TransactionContext): Promise<void>;
  list(query: AuditLogQuery): Promise<RepositoryPage<AuditLogRecord>>;
}

export interface RiskEventReader {
  list(query: RiskEventQuery): Promise<RepositoryPage<RiskEventRecord>>;
}
