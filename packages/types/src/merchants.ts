import type { IsoDateTime, Uuid } from './api.js';

/**
 * Merchant wire contracts (AGENTS.md section 10).
 *
 * `latitude` and `longitude` travel as decimal strings, never as binary
 * floating point: the column is `NUMERIC(9, 6)` and a value that round-trips
 * through `number` is not the value the database stored (the same reasoning as
 * ADR-008 for money).
 */
export type MerchantStatus = 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED' | 'DISABLED';

export type MerchantMemberRole = 'OWNER' | 'MANAGER' | 'CASHIER' | 'STAFF';

export interface MerchantSummaryResponse {
  id: Uuid;
  tradeName: string;
  status: MerchantStatus;
  cityId: Uuid;
  createdAt: IsoDateTime;
}

export interface MerchantDetailResponse {
  id: Uuid;
  ownerUserId: Uuid;
  cityId: Uuid;
  tradeName: string;
  legalName: string;
  rut: string;
  description: string | null;
  status: MerchantStatus;
  phoneE164: string;
  email: string;
  addressLine: string;
  latitude: string;
  longitude: string;
  timezone: string;
  acceptingOrders: boolean;
  temporarilyClosedUntil: IsoDateTime | null;
  approvedAt: IsoDateTime | null;
  rejectionReason: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface MerchantListResponse {
  data: readonly MerchantSummaryResponse[];
  meta: {
    totalCount: number;
    page: number;
    limit: number;
    hasNextPage: boolean;
  };
}

/**
 * Registration request.
 *
 * The caller does not choose an owner, a status or a commission rule: the owner
 * is the authenticated principal, the status starts at the schema default
 * (`PENDING_REVIEW`) and commission resolution belongs to a later phase.
 */
export interface RegisterMerchantRequest {
  cityId: Uuid;
  tradeName: string;
  legalName: string;
  rut: string;
  description?: string;
  phoneE164: string;
  email: string;
  addressLine: string;
  latitude: number;
  longitude: number;
}

export interface UpdateMerchantProfileRequest {
  tradeName?: string;
  legalName?: string;
  description?: string;
  phoneE164?: string;
  email?: string;
  addressLine?: string;
  latitude?: number;
  longitude?: number;
}

export interface RejectMerchantRequest {
  reason: string;
}
