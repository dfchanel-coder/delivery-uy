import { randomUUID } from 'node:crypto';
import type { AppRole, UserStatus } from '@deliveryuy/database';
import type {
  UserAdminEntity,
  UserAdminPaginated,
  UserAdminRepository,
  UserAdminSummaryEntity,
} from '../modules/users/ports.js';

/** Strips `readonly` so the double can mutate what it stores. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * In-memory double for the user administration port.
 *
 * It exists so the users HTTP specs can exercise the guard chain, the global
 * pipes and the response envelope without PostgreSQL (AGENTS.md section 5
 * allows mocks in tests). It is not a second implementation of the product:
 * `PrismaUserAdminRepository` is what production uses and it is covered by the
 * integration suite. What the double reproduces faithfully is the behaviour the
 * rules depend on: role sets, status and the count of active super admins that
 * protects the last one.
 */
export class InMemoryUserAdminRepository implements UserAdminRepository {
  private readonly users = new Map<string, Mutable<UserAdminEntity>>();

  /** Inserts an account and returns it, so a spec can arrange data with no SQL. */
  public seed(overrides: Partial<UserAdminEntity> = {}): UserAdminEntity {
    const now = new Date();
    const user: UserAdminEntity = {
      id: overrides.id ?? randomUUID(),
      email: overrides.email ?? `user-${this.users.size + 1}@example.com`,
      phoneE164: overrides.phoneE164 ?? null,
      status: overrides.status ?? 'ACTIVE',
      roles: overrides.roles ?? ['CUSTOMER'],
      locale: overrides.locale ?? 'es',
      emailVerifiedAt: overrides.emailVerifiedAt ?? now,
      phoneVerifiedAt: overrides.phoneVerifiedAt ?? null,
      failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      lastLoginAt: overrides.lastLoginAt ?? null,
      mustChangePassword: overrides.mustChangePassword ?? false,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    };

    this.users.set(user.id, { ...user });
    return user;
  }

  public async findMany(skip: number, take: number): Promise<UserAdminPaginated> {
    const ordered = [...this.users.values()].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    const data: UserAdminSummaryEntity[] = ordered.slice(skip, skip + take).map((user) => ({
      id: user.id,
      email: user.email,
      status: user.status,
      roles: user.roles,
      createdAt: user.createdAt,
    }));

    return { data, totalCount: ordered.length };
  }

  public async findById(id: string): Promise<UserAdminEntity | null> {
    return this.users.get(id) ?? null;
  }

  public async updateStatus(id: string, status: UserStatus): Promise<UserAdminEntity> {
    const user = this.require(id);
    user.status = status;
    user.updatedAt = new Date();
    return { ...user };
  }

  public async updateRoles(id: string, roles: readonly AppRole[]): Promise<UserAdminEntity> {
    const user = this.require(id);
    user.roles = [...roles];
    user.updatedAt = new Date();
    return { ...user };
  }

  public async countSuperAdmins(): Promise<number> {
    return [...this.users.values()].filter(
      (user) => user.status === 'ACTIVE' && user.roles.includes('SUPER_ADMIN'),
    ).length;
  }

  private require(id: string): Mutable<UserAdminEntity> {
    const user = this.users.get(id);

    if (user === undefined) throw new Error(`No user with id ${id} in the double.`);

    return user;
  }
}
