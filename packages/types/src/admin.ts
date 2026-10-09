import type { IsoDateTime } from './api.js';

/**
 * Admin surface contracts (docs/MODULE_BOUNDARIES.md: `types` holds
 * cross-surface DTOs and no logic).
 *
 * The admin web application, the API and the tests all read the same shapes
 * from here, so a field cannot be renamed on one side without the other failing
 * to compile.
 */

/**
 * Counts an administrator sees on the panel.
 *
 * Every map is keyed by the value the database stores (a status or role name),
 * never by a label: rendering a translated label is the client's job
 * (AGENTS.md section 44). A key absent from a map means zero rows in that state,
 * which is not the same as an unknown state.
 */
export interface AdminPanelSummary {
  readonly usersTotal: number;
  readonly usersByRole: Readonly<Record<string, number>>;
  readonly merchantsByStatus: Readonly<Record<string, number>>;
  readonly driversByStatus: Readonly<Record<string, number>>;
  readonly ordersByStatus: Readonly<Record<string, number>>;
  /** Neutral risk signals in the last 24 hours (AGENTS.md section 91). */
  readonly riskEventsLast24h: number;
}

/**
 * One audit entry (AGENTS.md section 29).
 *
 * `metadata` never contains passwords, tokens or card details; the writer is
 * responsible for that, and this shape cannot enforce it, so the rule is stated
 * where the writer lives.
 */
export interface AdminAuditLog {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorRole: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId: string | null;
  readonly createdAt: IsoDateTime;
}

/**
 * One neutral risk signal.
 *
 * Not a fraud verdict: it records a fact that an administrator may review
 * (AGENTS.md section 91).
 */
export interface AdminRiskEvent {
  readonly id: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly type: string;
  readonly severity: string;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  readonly createdAt: IsoDateTime;
}

/** A feature flag as the platform stores it. */
export interface AdminFeatureFlag {
  readonly key: string;
  readonly scope: string;
  readonly scopeRef: string | null;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly description: string | null;
  readonly updatedAt: IsoDateTime;
}
