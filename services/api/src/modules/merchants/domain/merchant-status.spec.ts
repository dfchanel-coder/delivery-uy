import { describe, expect, it } from 'vitest';
import { canTransitionMerchant } from './merchant-status.js';

/**
 * The review endpoints rely on this table to reject an impossible transition, so
 * the table itself is pinned here: a future edit that silently allowed
 * `ACTIVE -> PENDING_REVIEW`, or let a `DISABLED` business back in, would
 * otherwise only show up as a wrong status in production.
 */
describe('merchant lifecycle transitions', () => {
  it('lets a pending business be approved or rejected', () => {
    expect(canTransitionMerchant('PENDING_REVIEW', 'ACTIVE')).toBe(true);
    expect(canTransitionMerchant('PENDING_REVIEW', 'REJECTED')).toBe(true);
    expect(canTransitionMerchant('PENDING_REVIEW', 'SUSPENDED')).toBe(false);
    expect(canTransitionMerchant('PENDING_REVIEW', 'DISABLED')).toBe(false);
  });

  it('lets a rejected business be approved after the documents are fixed', () => {
    expect(canTransitionMerchant('REJECTED', 'ACTIVE')).toBe(true);
    expect(canTransitionMerchant('REJECTED', 'SUSPENDED')).toBe(false);
  });

  it('never sends an active business back to review', () => {
    expect(canTransitionMerchant('ACTIVE', 'PENDING_REVIEW')).toBe(false);
    expect(canTransitionMerchant('ACTIVE', 'REJECTED')).toBe(false);
    expect(canTransitionMerchant('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionMerchant('ACTIVE', 'DISABLED')).toBe(true);
  });

  it('lets a suspended business be reinstated or disabled', () => {
    expect(canTransitionMerchant('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionMerchant('SUSPENDED', 'DISABLED')).toBe(true);
    expect(canTransitionMerchant('SUSPENDED', 'REJECTED')).toBe(false);
  });

  it('treats disabled as terminal', () => {
    expect(canTransitionMerchant('DISABLED', 'ACTIVE')).toBe(false);
    expect(canTransitionMerchant('DISABLED', 'SUSPENDED')).toBe(false);
  });

  it('never allows a no-op transition', () => {
    for (const status of [
      'PENDING_REVIEW',
      'ACTIVE',
      'REJECTED',
      'SUSPENDED',
      'DISABLED',
    ] as const) {
      expect(canTransitionMerchant(status, status)).toBe(false);
    }
  });
});
