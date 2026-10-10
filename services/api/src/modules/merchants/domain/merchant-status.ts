import type { MerchantStatus } from '@deliveryuy/database';

/**
 * Allowed merchant lifecycle transitions (AGENTS.md section 13).
 *
 * A central validator, not a check inside a controller: `approve` and `reject`
 * both consult it, and a later `suspend`/`reinstate` endpoint will consult the
 * same table instead of growing its own rules.
 *
 * - `PENDING_REVIEW` is where onboarding leaves a business. An administrator
 *   approves or rejects it.
 * - `REJECTED` can be approved later: a merchant whose documents were fixed does
 *   not have to register again.
 * - `ACTIVE` can be suspended or disabled, never sent back to review.
 * - `DISABLED` is terminal; reactivating a disabled business is an open decision
 *   that no phase has made yet.
 *
 * Financial consequences (refunds, settlements) are deliberately absent: a
 * suspended merchant must not change historical settlement data (AGENTS.md
 * sections 21, 92).
 */
const ALLOWED_TRANSITIONS: Readonly<Record<MerchantStatus, readonly MerchantStatus[]>> =
  Object.freeze({
    PENDING_REVIEW: ['ACTIVE', 'REJECTED'],
    REJECTED: ['ACTIVE'],
    ACTIVE: ['SUSPENDED', 'DISABLED'],
    SUSPENDED: ['ACTIVE', 'DISABLED'],
    DISABLED: [],
  });

export function canTransitionMerchant(from: MerchantStatus, to: MerchantStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}
