import { describe, expect, it } from 'vitest';

import { SOFT_DELETABLE_TABLES, isSoftDeletable, notDeleted, softDelete } from './soft-delete.js';

describe('soft delete helpers', () => {
  it('lists only tables that may be soft deleted', () => {
    expect([...SOFT_DELETABLE_TABLES].sort()).toEqual([
      'addresses',
      'drivers',
      'merchants',
      'products',
      'users',
    ]);
  });

  it('never treats financial or audit tables as soft deletable', () => {
    for (const table of ['payments', 'refunds', 'audit_logs', 'order_timeline', 'sessions']) {
      expect(isSoftDeletable(table), `${table} must be immutable`).toBe(false);
    }
  });

  it('recognises every catalogued table', () => {
    for (const table of SOFT_DELETABLE_TABLES) {
      expect(isSoftDeletable(table)).toBe(true);
    }
  });

  it('exposes a filter that excludes deleted rows', () => {
    expect(notDeleted).toEqual({ deletedAt: null });
  });

  it('stamps the deletion time provided by the caller', () => {
    const at = new Date('2026-10-01T12:00:00.000Z');

    expect(softDelete(at)).toEqual({ deletedAt: at });
    expect(softDelete(at).deletedAt).toBe(at);
  });
});
