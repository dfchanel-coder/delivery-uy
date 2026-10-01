/**
 * Soft delete catalogue (docs/SCHEMA_PROPOSAL.md section 2, DATABASE.md).
 *
 * Services must not hand-write `deletedAt: null` in filters: forgetting it
 * silently returns deleted rows, and forgetting it in a unique constraint lets
 * a soft-deleted row block a legitimate insert. `SOFT_DELETABLE_TABLES` is the
 * single source of truth and the schema test fails when the schema and this
 * list drift apart.
 *
 * Records that must never disappear are deliberately absent: payments, refunds,
 * audit logs and the order timeline are append-only and immutable by design
 * (AGENTS.md section 28).
 */
export const SOFT_DELETABLE_TABLES = [
  'addresses',
  'drivers',
  'merchants',
  'products',
  'users',
] as const;

export type SoftDeletableTable = (typeof SOFT_DELETABLE_TABLES)[number];

const SOFT_DELETABLE_TABLE_SET: ReadonlySet<string> = new Set(SOFT_DELETABLE_TABLES);

export function isSoftDeletable(table: string): table is SoftDeletableTable {
  return SOFT_DELETABLE_TABLE_SET.has(table);
}

/**
 * Filter that excludes soft-deleted rows.
 *
 * Pass it to every read of a soft-deletable model:
 * `where: { ...notDeleted, cityId }`.
 */
export const notDeleted = { deletedAt: null } as const;

/**
 * Marks a row as deleted without removing it.
 *
 * `at` must be injected by the caller so the timestamp follows the same clock as
 * the rest of the request and stays testable.
 */
export function softDelete(at: Date): { deletedAt: Date } {
  return { deletedAt: at };
}
