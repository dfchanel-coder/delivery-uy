import type { UserStatus, AppRole } from '@deliveryuy/database';

export interface UserAdminEntity {
  id: string;
  email: string;
  phoneE164: string | null;
  status: UserStatus;
  roles: readonly AppRole[];
  locale: string;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserAdminSummaryEntity {
  id: string;
  email: string;
  status: UserStatus;
  roles: readonly AppRole[];
  createdAt: Date;
}

export interface UserAdminPaginated {
  data: readonly UserAdminSummaryEntity[];
  totalCount: number;
}

export interface UserAdminRepository {
  findMany(skip: number, take: number): Promise<UserAdminPaginated>;
  findById(id: string): Promise<UserAdminEntity | null>;
  updateStatus(id: string, status: UserStatus): Promise<UserAdminEntity>;
  updateRoles(id: string, roles: readonly AppRole[]): Promise<UserAdminEntity>;
  countSuperAdmins(): Promise<number>;
}
