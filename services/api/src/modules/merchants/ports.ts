import type { MerchantMemberRole, MerchantStatus } from '@deliveryuy/database';
import type { TransactionContext } from '../../common/database/unit-of-work.js';

/**
 * Merchant persistence ports (`merchants` owns `merchants`, `merchant_members`,
 * `merchant_schedules`, `merchant_closures`; docs/MODULE_BOUNDARIES.md).
 *
 * The service depends on these interfaces rather than on Prisma so the rules
 * that matter - one status per business, a check-digit RUT, membership before
 * access - are testable without a database, and so a second storage
 * implementation cannot bypass them.
 */

export interface MerchantRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly cityId: string;
  readonly tradeName: string;
  readonly legalName: string;
  readonly rut: string;
  readonly rutNormalized: string;
  readonly description: string | null;
  readonly status: MerchantStatus;
  readonly phoneE164: string;
  readonly email: string;
  readonly addressLine: string;
  /** Stored as `NUMERIC(9, 6)`, so it travels as a decimal string, never a float. */
  readonly latitude: string;
  readonly longitude: string;
  readonly timezone: string;
  readonly acceptingOrders: boolean;
  readonly temporarilyClosedUntil: Date | null;
  readonly approvedAt: Date | null;
  readonly approvedByUserId: string | null;
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MerchantSummaryRecord {
  readonly id: string;
  readonly tradeName: string;
  readonly status: MerchantStatus;
  readonly cityId: string;
  readonly createdAt: Date;
}

export interface MerchantMembershipRecord {
  readonly merchantId: string;
  readonly userId: string;
  readonly role: MerchantMemberRole;
}

export interface RegisterMerchantInput {
  readonly ownerUserId: string;
  readonly cityId: string;
  readonly tradeName: string;
  readonly legalName: string;
  readonly rut: string;
  readonly rutNormalized: string;
  readonly description: string | null;
  readonly phoneE164: string;
  readonly email: string;
  readonly addressLine: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly timezone: string;
  readonly now: Date;
}

export interface MerchantProfilePatch {
  readonly tradeName?: string;
  readonly legalName?: string;
  readonly description?: string | null;
  readonly phoneE164?: string;
  readonly email?: string;
  readonly addressLine?: string;
  readonly latitude?: string;
  readonly longitude?: string;
}

export interface MerchantAdminQuery {
  readonly skip: number;
  readonly take: number;
  readonly status?: MerchantStatus;
}

export interface MerchantAdminPage {
  readonly data: readonly MerchantSummaryRecord[];
  readonly totalCount: number;
}

/**
 * Raised by the adapter when the unique `rut_normalized` constraint rejects an
 * insert.
 *
 * A pre-check in the service catches the ordinary case, but two concurrent
 * registrations of the same RUT can both pass it; translating the constraint
 * here is what turns that race into a `CONFLICT` instead of a 500. The port
 * cannot expose Prisma's error type, so it exposes a reason the service maps.
 */
export class MerchantRutConflictError extends Error {
  public constructor(public readonly rutNormalized: string) {
    super(`A merchant already exists for RUT ${rutNormalized}.`);
    this.name = 'MerchantRutConflictError';
  }
}

export interface MerchantRepository {
  /**
   * Inserts the business and its `OWNER` membership as one unit.
   *
   * The caller passes `tx` so the write joins the transaction that also grants
   * the `MERCHANT` role and records the audit entry: a business with no owner
   * membership, or a grant with no business, is not a state the platform should
   * be able to reach (AGENTS.md section 83).
   */
  createWithOwner(input: RegisterMerchantInput, tx: TransactionContext): Promise<MerchantRecord>;
  findByRutNormalized(rutNormalized: string): Promise<MerchantRecord | null>;
  findById(id: string): Promise<MerchantRecord | null>;
  /** Every business the account belongs to, newest first. */
  listByMember(userId: string): Promise<readonly MerchantSummaryRecord[]>;
  findMembership(merchantId: string, userId: string): Promise<MerchantMembershipRecord | null>;
  updateProfile(
    id: string,
    patch: MerchantProfilePatch,
    tx?: TransactionContext,
  ): Promise<MerchantRecord>;
  approve(
    id: string,
    input: { approvedAt: Date; approvedByUserId: string },
    tx?: TransactionContext,
  ): Promise<MerchantRecord>;
  reject(
    id: string,
    input: { rejectionReason: string },
    tx?: TransactionContext,
  ): Promise<MerchantRecord>;
  listForAdmin(query: MerchantAdminQuery): Promise<MerchantAdminPage>;
}
