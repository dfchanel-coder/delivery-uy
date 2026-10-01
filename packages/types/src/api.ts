/**
 * API transport contracts (docs/API_RULES.md).
 *
 * These types describe the wire format only. They contain no business rules:
 * the backend always revalidates anything a client sends.
 */

/** ISO 8601 timestamp in UTC, e.g. `2026-09-30T12:00:00.000Z`. */
export type IsoDateTime = string;

/**
 * Monetary amount on the wire.
 *
 * Always a fixed 2-decimal string. Binary floating point representations are
 * never returned (ADR-008).
 */
export type MoneyString = string;

/** ISO 4217 alphabetic currency code. */
export type CurrencyCode = string;

/** UUID v4 as produced by the database. */
export type Uuid = string;

/** Public, human-quotable business code (orders, tickets, settlements). */
export type BusinessCode = string;

export interface ApiSuccess<T> {
  data: T;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ApiFailure {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface CursorPage<T> {
  items: T[];
  pagination: PaginationMeta;
}

/**
 * Health probe payloads.
 *
 * These are wire contracts shared by the backend and every client (including
 * the admin panel), so a probe cannot drift between producer and consumer.
 */
export interface HealthDependencyStatus {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthLiveness {
  status: 'ok';
  service: string;
  environment: string;
  uptimeSeconds: number;
}

export interface HealthReadiness {
  status: 'ready' | 'degraded';
  dependencies: {
    database: HealthDependencyStatus;
    redis: HealthDependencyStatus;
  };
  checkedAt: IsoDateTime;
}

export interface OrderMoneyBreakdown {
  subtotal: MoneyString;
  discountTotal: MoneyString;
  deliveryFee: MoneyString;
  serviceFee: MoneyString;
  taxTotal: MoneyString;
  total: MoneyString;
  refundedTotal: MoneyString;
  currency: CurrencyCode;
}
