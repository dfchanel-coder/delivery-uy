import { Inject, Injectable } from '@nestjs/common';
import type { MerchantStatus } from '@deliveryuy/database';
import { ERROR_CODES } from '@deliveryuy/types';
import { UNIT_OF_WORK, type UnitOfWork } from '../../common/database/unit-of-work.js';
import { ApiException } from '../../common/errors/api-exception.js';
import type { AuditActor } from '../audit/audit.ports.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { GeoService } from '../geo/geo.service.js';
import { canTransitionMerchant } from './domain/merchant-status.js';
import { isValidRut, normalizeRut } from './domain/rut.js';
import { MERCHANT_REPOSITORY } from './merchants.tokens.js';
import {
  MerchantRutConflictError,
  type MerchantAdminPage,
  type MerchantMembershipRecord,
  type MerchantProfilePatch,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantSummaryRecord,
} from './ports.js';

/** Audit actions recorded by the merchant module. */
export const MERCHANT_REGISTERED_ACTION = 'merchant.registered';
export const MERCHANT_APPROVED_ACTION = 'merchant.approved';
export const MERCHANT_REJECTED_ACTION = 'merchant.rejected';

export interface RegisterMerchantCommand {
  readonly cityId: string;
  readonly tradeName: string;
  readonly legalName: string;
  readonly rut: string;
  readonly description?: string;
  readonly phoneE164: string;
  readonly email: string;
  readonly addressLine: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface UpdateMerchantProfileCommand {
  readonly tradeName?: string;
  readonly legalName?: string;
  readonly description?: string;
  readonly phoneE164?: string;
  readonly email?: string;
  readonly addressLine?: string;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface MerchantAdminListQuery {
  readonly page: number;
  readonly limit: number;
  readonly status?: MerchantStatus;
}

/**
 * Merchant onboarding, profile and review (AGENTS.md sections 10, 12, 93).
 *
 * Onboarding is the one place the platform grants the `MERCHANT` role, and it
 * does so inside the same transaction that creates the business: an account with
 * the role but no business, or a business whose owner cannot reach it, is a
 * state that cannot be reached. The privileged review actions are audited in
 * that same transaction for the same reason (AGENTS.md section 83).
 */
@Injectable()
export class MerchantsService {
  public constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    private readonly auth: AuthService,
    private readonly geo: GeoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registers a business for the authenticated account and starts the review.
   *
   * The caller cannot choose the owner, the status or the timezone: the owner is
   * the principal, the status is the schema default (`PENDING_REVIEW`) and the
   * timezone comes from the chosen city. The `MERCHANT` role is granted here, so
   * the account can manage the business it just created; that is the deliberate
   * self-service flow documented in SECURITY.md, distinct from `/auth/register`
   * which still only mints a `CUSTOMER`.
   */
  public async register(
    command: RegisterMerchantCommand,
    actor: AuditActor,
  ): Promise<MerchantRecord> {
    if (!isValidRut(command.rut)) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        'The RUT is not a valid Uruguayan RUT.',
        { field: 'rut' },
      );
    }

    const rutNormalized = normalizeRut(command.rut);
    const city = await this.geo.requireCity(command.cityId);

    const account = await this.auth.currentUser(actor.userId);
    if (account.status !== 'ACTIVE') {
      throw new ApiException(
        ERROR_CODES.FORBIDDEN,
        'An inactive account cannot register a merchant.',
      );
    }

    const existing = await this.merchants.findByRutNormalized(rutNormalized);
    if (existing !== null) {
      throw new ApiException(ERROR_CODES.MERCHANT_RUT_CONFLICT, 'That RUT is already registered.', {
        field: 'rut',
      });
    }

    const now = new Date();

    try {
      return await this.unitOfWork.runInTransaction(async (tx) => {
        const merchant = await this.merchants.createWithOwner(
          {
            ownerUserId: actor.userId,
            cityId: city.id,
            tradeName: command.tradeName.trim(),
            legalName: command.legalName.trim(),
            rut: command.rut.trim(),
            rutNormalized,
            description: command.description?.trim() || null,
            phoneE164: command.phoneE164,
            email: command.email,
            addressLine: command.addressLine.trim(),
            latitude: formatCoordinate(command.latitude),
            longitude: formatCoordinate(command.longitude),
            timezone: city.timezone,
            now,
          },
          tx,
        );

        await this.auth.grantMerchantRole(actor.userId, tx);
        await this.audit.record(
          actor,
          {
            action: MERCHANT_REGISTERED_ACTION,
            entityType: 'Merchant',
            entityId: merchant.id,
            metadata: { cityId: city.id, rutNormalized },
          },
          tx,
        );

        return merchant;
      });
    } catch (error) {
      // The pre-check above is not enough: two concurrent registrations of the
      // same RUT can both pass it. The unique constraint is the real arbiter and
      // its violation is a client error, not a 500.
      if (error instanceof MerchantRutConflictError) {
        throw new ApiException(
          ERROR_CODES.MERCHANT_RUT_CONFLICT,
          'That RUT is already registered.',
          { field: 'rut' },
        );
      }

      throw error;
    }
  }

  /** Every business the account belongs to, newest first. */
  public listMine(userId: string): Promise<readonly MerchantSummaryRecord[]> {
    return this.merchants.listByMember(userId);
  }

  public async getForMember(merchantId: string, userId: string): Promise<MerchantRecord> {
    await this.requireMembership(merchantId, userId);

    const merchant = await this.merchants.findById(merchantId);
    if (merchant === null) {
      throw ApiException.notFound(ERROR_CODES.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    return merchant;
  }

  public async updateProfile(
    merchantId: string,
    userId: string,
    command: UpdateMerchantProfileCommand,
  ): Promise<MerchantRecord> {
    const membership = await this.requireMembership(merchantId, userId);

    if (membership.role !== 'OWNER' && membership.role !== 'MANAGER') {
      throw new ApiException(
        ERROR_CODES.FORBIDDEN,
        'Only an owner or a manager may change the business profile.',
      );
    }

    const current = await this.merchants.findById(merchantId);
    if (current === null) {
      throw ApiException.notFound(ERROR_CODES.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    // The legal identity of an approved business is not self-editable: changing
    // it after approval would let an approved storefront be silently reassigned
    // to another taxpayer. RUT is immutable in every status for the same reason
    // (it is not a field of the patch type at all).
    if (
      command.legalName !== undefined &&
      current.status === 'ACTIVE' &&
      command.legalName.trim() !== current.legalName
    ) {
      throw new ApiException(
        ERROR_CODES.MERCHANT_INVALID_STATE,
        'The legal name of an active merchant cannot be changed.',
      );
    }

    const patch = normalizePatch(command);

    if (Object.keys(patch).length === 0) return current;

    return this.merchants.updateProfile(merchantId, patch);
  }

  public async listForAdmin(query: MerchantAdminListQuery): Promise<MerchantAdminPage> {
    const skip = (query.page - 1) * query.limit;

    return this.merchants.listForAdmin({ skip, take: query.limit, status: query.status });
  }

  public async getForAdmin(merchantId: string): Promise<MerchantRecord> {
    const merchant = await this.merchants.findById(merchantId);

    if (merchant === null) {
      throw ApiException.notFound(ERROR_CODES.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    return merchant;
  }

  /** Approves a pending or previously rejected business (AGENTS.md section 12). */
  public async approve(actor: AuditActor, merchantId: string): Promise<MerchantRecord> {
    return this.unitOfWork.runInTransaction(async (tx) => {
      const merchant = await this.requireForReview(merchantId, 'ACTIVE');
      const now = new Date();

      const approved = await this.merchants.approve(
        merchantId,
        { approvedAt: now, approvedByUserId: actor.userId },
        tx,
      );

      await this.audit.record(
        actor,
        {
          action: MERCHANT_APPROVED_ACTION,
          entityType: 'Merchant',
          entityId: merchantId,
          metadata: { previousStatus: merchant.status },
        },
        tx,
      );

      return approved;
    });
  }

  /** Rejects a business awaiting review, with a reason the merchant can act on. */
  public async reject(
    actor: AuditActor,
    merchantId: string,
    reason: string,
  ): Promise<MerchantRecord> {
    return this.unitOfWork.runInTransaction(async (tx) => {
      const merchant = await this.requireForReview(merchantId, 'REJECTED');

      const rejected = await this.merchants.reject(
        merchantId,
        { rejectionReason: reason.trim() },
        tx,
      );

      await this.audit.record(
        actor,
        {
          action: MERCHANT_REJECTED_ACTION,
          entityType: 'Merchant',
          entityId: merchantId,
          metadata: { previousStatus: merchant.status },
        },
        tx,
      );

      return rejected;
    });
  }

  private async requireForReview(
    merchantId: string,
    target: MerchantStatus,
  ): Promise<MerchantRecord> {
    const merchant = await this.merchants.findById(merchantId);

    if (merchant === null) {
      throw ApiException.notFound(ERROR_CODES.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    if (!canTransitionMerchant(merchant.status, target)) {
      throw new ApiException(
        ERROR_CODES.MERCHANT_INVALID_STATE,
        `A merchant in ${merchant.status} cannot move to ${target}.`,
        { status: merchant.status },
      );
    }

    return merchant;
  }

  /**
   * Resolves the caller's membership, answering `NOT_FOUND` when there is none.
   *
   * A caller that does not belong to the business must not be able to tell an
   * existing id from a missing one, so the two cases are indistinguishable on the
   * wire (AGENTS.md section 32).
   */
  private async requireMembership(
    merchantId: string,
    userId: string,
  ): Promise<MerchantMembershipRecord> {
    const membership = await this.merchants.findMembership(merchantId, userId);

    if (membership === null) {
      throw ApiException.notFound(ERROR_CODES.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    return membership;
  }
}

/**
 * Renders a validated coordinate as a fixed 6-decimal string.
 *
 * The column is `NUMERIC(9, 6)`; sending the raw `number` would let Prisma's
 * decimal conversion depend on the binary value, and the same coordinate sent
 * twice could store differently.
 */
function formatCoordinate(value: number): string {
  if (!Number.isFinite(value)) {
    throw new ApiException(ERROR_CODES.VALIDATION_FAILED, 'Coordinates must be finite numbers.', {
      value,
    });
  }

  return value.toFixed(6);
}

function normalizePatch(command: UpdateMerchantProfileCommand): MerchantProfilePatch {
  const patch: {
    -readonly [K in keyof MerchantProfilePatch]: MerchantProfilePatch[K];
  } = {};

  if (command.tradeName !== undefined) patch.tradeName = command.tradeName.trim();
  if (command.legalName !== undefined) patch.legalName = command.legalName.trim();
  if (command.description !== undefined) {
    patch.description = command.description.trim() === '' ? null : command.description.trim();
  }
  if (command.phoneE164 !== undefined) patch.phoneE164 = command.phoneE164;
  if (command.email !== undefined) patch.email = command.email;
  if (command.addressLine !== undefined) patch.addressLine = command.addressLine.trim();
  if (command.latitude !== undefined) patch.latitude = formatCoordinate(command.latitude);
  if (command.longitude !== undefined) patch.longitude = formatCoordinate(command.longitude);

  return patch;
}
