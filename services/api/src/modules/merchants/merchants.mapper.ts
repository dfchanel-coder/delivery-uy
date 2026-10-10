import type { MerchantDetailResponse, MerchantSummaryResponse } from '@deliveryuy/types';
import type { MerchantRecord, MerchantSummaryRecord } from './ports.js';

/**
 * Maps a stored business to its wire shape.
 *
 * The mapping lives beside the module rather than in the controller because two
 * controllers (merchant-facing and review) return the same shape; a second copy
 * is how a field ends up present on one route and missing on another. Dates
 * become ISO strings and coordinates stay decimal strings (see
 * `packages/types/src/merchants.ts`).
 */
export function toMerchantSummary(record: MerchantSummaryRecord): MerchantSummaryResponse {
  return {
    id: record.id,
    tradeName: record.tradeName,
    status: record.status,
    cityId: record.cityId,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toMerchantDetail(record: MerchantRecord): MerchantDetailResponse {
  return {
    id: record.id,
    ownerUserId: record.ownerUserId,
    cityId: record.cityId,
    tradeName: record.tradeName,
    legalName: record.legalName,
    rut: record.rut,
    description: record.description,
    status: record.status,
    phoneE164: record.phoneE164,
    email: record.email,
    addressLine: record.addressLine,
    latitude: record.latitude,
    longitude: record.longitude,
    timezone: record.timezone,
    acceptingOrders: record.acceptingOrders,
    temporarilyClosedUntil: record.temporarilyClosedUntil?.toISOString() ?? null,
    approvedAt: record.approvedAt?.toISOString() ?? null,
    rejectionReason: record.rejectionReason,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
