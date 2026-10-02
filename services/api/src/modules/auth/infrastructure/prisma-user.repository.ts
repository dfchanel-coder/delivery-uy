import { Inject, Injectable } from '@nestjs/common';
import { AppRole, Prisma, PrismaClient, UserStatus } from '@deliveryuy/database';
import type { AuthUserRecord, UserRepository, UserStatus as AuthUserStatus } from '../ports.js';

/** Shape returned by the hand-written lookup below. */
interface RawUserRow {
  id: string;
  email: string;
  passwordHash: string;
  status: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  emailVerifiedAt: Date | null;
  mustChangePassword: boolean;
  locale: string;
  createdAt: Date;
  roles: string[];
}

/** Roles are aggregated as an array by PostgreSQL, and Prisma returns it as a list. */
function toAuthUser(row: RawUserRow): AuthUserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status as AuthUserStatus,
    roles: row.roles,
    failedLoginAttempts: Number(row.failedLoginAttempts),
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    emailVerifiedAt: row.emailVerifiedAt,
    mustChangePassword: row.mustChangePassword,
    locale: row.locale,
    createdAt: row.createdAt,
  };
}

/**
 * Accounts, backed by PostgreSQL.
 *
 * Two invariants are enforced here rather than in the service, because only the
 * database can enforce them safely (AGENTS.md section 26):
 * - a soft-deleted account is invisible to authentication;
 * - the failure counter and the lock decision happen in one transaction, so
 *   concurrent attempts cannot each read the same count and dodge the threshold.
 */
@Injectable()
export class PrismaUserRepository implements UserRepository {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  /**
   * Case-insensitive lookup by email.
   *
   * Written as SQL on purpose. The unique index created by migration
   * `0001_init_constraints.sql` is on `lower(email)`, so this is the only shape
   * of query PostgreSQL can answer from that index; Prisma's
   * `mode: 'insensitive'` emits `ILIKE`, which would turn every login into a
   * sequential scan of `users`.
   */
  public async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const rows = await this.prisma.$queryRaw<RawUserRow[]>(Prisma.sql`
      SELECT
        u."id",
        u."email",
        u."password_hash" AS "passwordHash",
        u."status",
        u."failed_login_attempts" AS "failedLoginAttempts",
        u."locked_until" AS "lockedUntil",
        u."last_login_at" AS "lastLoginAt",
        u."email_verified_at" AS "emailVerifiedAt",
        u."must_change_password" AS "mustChangePassword",
        u."locale",
        u."created_at" AS "createdAt",
        COALESCE(
          array_agg(ur."role") FILTER (WHERE ur."role" IS NOT NULL),
          ARRAY[]::"AppRole"[]
        ) AS "roles"
      FROM "users" u
      LEFT JOIN "user_roles" ur ON ur."user_id" = u."id"
      WHERE lower(u."email") = lower(${email}) AND u."deleted_at" IS NULL
      GROUP BY u."id"
    `);

    const row = rows[0];
    return row === undefined ? null : toAuthUser(row);
  }

  public async findById(id: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        locale: true,
        createdAt: true,
        roles: { select: { role: true } },
      },
    });

    if (user === null) return null;

    return {
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      status: user.status,
      roles: user.roles.map((entry) => entry.role),
      failedLoginAttempts: user.failedLoginAttempts,
      lockedUntil: user.lockedUntil,
      lastLoginAt: user.lastLoginAt,
      emailVerifiedAt: user.emailVerifiedAt,
      mustChangePassword: user.mustChangePassword,
      locale: user.locale,
      createdAt: user.createdAt,
    };
  }

  /**
   * Creates a self-registered customer.
   *
   * The address is expected already normalized; the case-insensitive unique
   * index is what makes a duplicate registration impossible even if two requests
   * race. A lost race surfaces as a constraint violation, which the caller
   * reports as `EMAIL_ALREADY_REGISTERED`.
   */
  public async createCustomer(input: {
    email: string;
    passwordHash: string;
    role: string;
    status: AuthUserStatus;
    now: Date;
  }): Promise<AuthUserRecord> {
    const created = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        status: input.status,
        createdAt: input.now,
        updatedAt: input.now,
        roles: { create: [{ role: input.role as AppRole }] },
      },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        status: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        lastLoginAt: true,
        emailVerifiedAt: true,
        mustChangePassword: true,
        locale: true,
        createdAt: true,
        roles: { select: { role: true } },
      },
    });

    return {
      id: created.id,
      email: created.email,
      passwordHash: created.passwordHash,
      status: created.status,
      roles: created.roles.map((entry) => entry.role),
      failedLoginAttempts: created.failedLoginAttempts,
      lockedUntil: created.lockedUntil,
      lastLoginAt: created.lastLoginAt,
      emailVerifiedAt: created.emailVerifiedAt,
      mustChangePassword: created.mustChangePassword,
      locale: created.locale,
      createdAt: created.createdAt,
    };
  }

  /**
   * Increments the failure counter and applies the lock atomically.
   *
   * The count is re-read inside the transaction, so the threshold is judged on
   * the stored value and not on whatever the service saw before hashing the
   * password. An account that is already locked keeps its lock: the countdown
   * belongs to the service, which knows `now`.
   */
  public async registerFailedLogin(input: {
    userId: string;
    now: Date;
    maxAttempts: number;
    lockUntil: Date | null;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: input.userId },
        select: { failedLoginAttempts: true, lockedUntil: true },
      });

      // The account was deleted between the read and this write.
      if (current === null) return;

      const attempts = current.failedLoginAttempts + 1;
      const lockIsActive =
        current.lockedUntil !== null && current.lockedUntil.getTime() > input.now.getTime();
      const shouldLock = !lockIsActive && attempts >= input.maxAttempts && input.lockUntil !== null;

      await tx.user.update({
        where: { id: input.userId },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil: shouldLock ? input.lockUntil : current.lockedUntil,
          updatedAt: input.now,
        },
      });
    });
  }

  public async registerSuccessfulLogin(input: { userId: string; now: Date }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: input.now,
        updatedAt: input.now,
      },
    });
  }

  public async updatePasswordHash(input: {
    userId: string;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.userId },
      data: { passwordHash: input.passwordHash, updatedAt: input.now },
    });
  }

  public async markEmailVerified(input: {
    userId: string;
    now: Date;
    activate: boolean;
  }): Promise<void> {
    await this.prisma.user.update({
      where: { id: input.userId },
      data: {
        emailVerifiedAt: input.now,
        status: input.activate ? UserStatus.ACTIVE : undefined,
        updatedAt: input.now,
      },
    });
  }
}
