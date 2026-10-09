import { Injectable } from '@nestjs/common';
import { AppRole, UserStatus, PrismaClient } from '@deliveryuy/database';
import type {
  UserAdminEntity,
  UserAdminPaginated,
  UserAdminRepository,
  UserAdminSummaryEntity,
} from '../ports.js';

@Injectable()
export class PrismaUserAdminRepository implements UserAdminRepository {
  public constructor(private readonly prisma: PrismaClient) {}

  public async findMany(skip: number, take: number): Promise<UserAdminPaginated> {
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          email: true,
          status: true,
          createdAt: true,
          roles: {
            select: { role: true },
          },
        },
      }),
    ]);

    const data: UserAdminSummaryEntity[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
      roles: row.roles.map((r) => r.role),
      createdAt: row.createdAt,
    }));

    return { totalCount, data };
  }

  public async findById(id: string): Promise<UserAdminEntity | null> {
    const row = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        roles: { select: { role: true } },
      },
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      email: row.email,
      phoneE164: row.phoneE164,
      status: row.status,
      roles: row.roles.map((r) => r.role),
      locale: row.locale,
      emailVerifiedAt: row.emailVerifiedAt,
      phoneVerifiedAt: row.phoneVerifiedAt,
      failedLoginAttempts: row.failedLoginAttempts,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async updateStatus(id: string, status: UserStatus): Promise<UserAdminEntity> {
    const row = await this.prisma.user.update({
      where: { id },
      data: { status },
      include: {
        roles: { select: { role: true } },
      },
    });

    return {
      id: row.id,
      email: row.email,
      phoneE164: row.phoneE164,
      status: row.status,
      roles: row.roles.map((r) => r.role),
      locale: row.locale,
      emailVerifiedAt: row.emailVerifiedAt,
      phoneVerifiedAt: row.phoneVerifiedAt,
      failedLoginAttempts: row.failedLoginAttempts,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async updateRoles(id: string, roles: readonly AppRole[]): Promise<UserAdminEntity> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: id },
      });

      if (roles.length > 0) {
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: id, role })),
        });
      }

      return tx.user.findUniqueOrThrow({
        where: { id },
        include: {
          roles: { select: { role: true } },
        },
      });
    });

    return {
      id: row.id,
      email: row.email,
      phoneE164: row.phoneE164,
      status: row.status,
      roles: row.roles.map((r) => r.role),
      locale: row.locale,
      emailVerifiedAt: row.emailVerifiedAt,
      phoneVerifiedAt: row.phoneVerifiedAt,
      failedLoginAttempts: row.failedLoginAttempts,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      mustChangePassword: row.mustChangePassword,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async countSuperAdmins(): Promise<number> {
    return this.prisma.userRole.count({
      where: {
        role: 'SUPER_ADMIN',
        user: { deletedAt: null },
      },
    });
  }
}
