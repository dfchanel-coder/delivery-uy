import type { IsoDateTime, Uuid } from './api.js';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface UserSummaryResponse {
  id: Uuid;
  email: string;
  status: UserStatus;
  roles: readonly string[];
  createdAt: IsoDateTime;
}

export interface UserDetailResponse {
  id: Uuid;
  email: string;
  phoneE164: string | null;
  status: UserStatus;
  roles: readonly string[];
  locale: string;
  emailVerifiedAt: IsoDateTime | null;
  phoneVerifiedAt: IsoDateTime | null;
  failedLoginAttempts: number;
  lockedUntil: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  mustChangePassword: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface UserListResponse {
  data: readonly UserSummaryResponse[];
  meta: {
    totalCount: number;
    page: number;
    limit: number;
    hasNextPage: boolean;
  };
}

export interface UpdateUserStatusRequest {
  status: UserStatus;
}

export interface UpdateUserRolesRequest {
  roles: readonly string[];
}
