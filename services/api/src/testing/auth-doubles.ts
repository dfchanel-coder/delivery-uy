import { randomUUID } from 'node:crypto';
import type { Clock } from '../modules/auth/auth.tokens.js';
import type {
  AuthUserRecord,
  EmailVerificationNotifier,
  NewSession,
  PasswordRecoveryNotifier,
  PasswordResetTokenInput,
  PasswordResetTokenRecord,
  PasswordResetTokenRepository,
  RiskEventInput,
  RiskEventRepository,
  SessionRecord,
  SessionRepository,
  UserRepository,
  VerificationTokenKind,
  VerificationTokenRecord,
  VerificationTokenRepository,
} from '../modules/auth/ports.js';

/** Strips `readonly` so a test double can mutate what it stores. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * In-memory doubles for the auth ports.
 *
 * They exist so the security rules can be tested without infrastructure
 * (AGENTS.md section 5 allows mocks in tests). They are not a second
 * implementation of the product: the Prisma adapters in
 * `modules/auth/infrastructure` are what production uses, and they are covered
 * by the database integration tests that run in CI.
 *
 * What these doubles do reproduce faithfully is the behaviour the rules depend on:
 * soft-deleted rows are invisible, a rotation claim is exclusive, and a consumed
 * recovery token cannot be used twice.
 */

/**
 * A clock the test moves by hand.
 *
 * It starts at the real current time rather than a fixed date because access
 * tokens are signed with the wall clock by `jose`; starting far away from it
 * would make every relative expiry assertion in these tests meaningless.
 */
export class FakeClock implements Clock {
  public constructor(private current: Date = new Date()) {}

  public now(): Date {
    return new Date(this.current);
  }

  public advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** Stored mutable: a test may simulate soft deletion on a record it holds. */
type StoredUser = Mutable<AuthUserRecord>;

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, StoredUser>();

  /** Set by a test to simulate a soft-deleted account. */
  public softDelete(id: string, at: Date = new Date()): void {
    const user = this.users.get(id);

    if (user !== undefined) (user as { deletedAt?: Date }).deletedAt = at;
  }

  public async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const wanted = email.trim().toLowerCase();

    for (const user of this.users.values()) {
      if (this.isDeleted(user)) continue;
      if (user.email.toLowerCase() === wanted) return { ...user };
    }

    return null;
  }

  public async findById(id: string): Promise<AuthUserRecord | null> {
    const user = this.users.get(id);
    if (user === undefined || this.isDeleted(user)) return null;

    return { ...user };
  }

  /** Test helper: every account still stored, for assertions about the whole set. */
  public all(): AuthUserRecord[] {
    return [...this.users.values()].map((user) => ({ ...user }));
  }

  public async createCustomer(input: {
    email: string;
    passwordHash: string;
    role: string;
    status: AuthUserRecord['status'];
    now: Date;
  }): Promise<AuthUserRecord> {
    const created: StoredUser = {
      id: randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      status: input.status,
      roles: [input.role],
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      emailVerifiedAt: null,
      mustChangePassword: false,
      locale: 'es',
      createdAt: input.now,
    };

    this.users.set(created.id, created);

    return { ...created };
  }

  public async registerFailedLogin(input: {
    userId: string;
    now: Date;
    maxAttempts: number;
    lockUntil: Date | null;
  }): Promise<void> {
    const user = this.users.get(input.userId);
    if (user === undefined) return;

    const lockIsActive =
      user.lockedUntil !== null && user.lockedUntil.getTime() > input.now.getTime();

    user.failedLoginAttempts += 1;

    if (
      !lockIsActive &&
      user.failedLoginAttempts >= input.maxAttempts &&
      input.lockUntil !== null
    ) {
      user.lockedUntil = input.lockUntil;
    }
  }

  public async registerSuccessfulLogin(input: { userId: string; now: Date }): Promise<void> {
    const user = this.users.get(input.userId);
    if (user === undefined) return;

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = input.now;
  }

  public async updatePasswordHash(input: {
    userId: string;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    const user = this.users.get(input.userId);
    if (user === undefined) return;

    user.passwordHash = input.passwordHash;
  }

  public async markEmailVerified(input: {
    userId: string;
    now: Date;
    activate: boolean;
  }): Promise<void> {
    const user = this.users.get(input.userId);
    if (user === undefined) return;

    user.emailVerifiedAt = input.now;
    // Only a pending account may be activated, exactly like the Prisma adapter:
    // a late code must not lift a suspension.
    if (input.activate && user.status === 'PENDING_VERIFICATION') user.status = 'ACTIVE';
  }

  /** Test helper: changes the account status, as an administrator would. */
  public setStatus(id: string, status: AuthUserRecord['status']): void {
    const user = this.users.get(id);

    if (user !== undefined) user.status = status;
  }

  /** Test helper: seeds an account without going through registration. */
  public seed(
    overrides: Partial<StoredUser> & { email: string; passwordHash: string },
  ): AuthUserRecord {
    const user: StoredUser = {
      id: overrides.id ?? randomUUID(),
      email: overrides.email,
      passwordHash: overrides.passwordHash,
      status: overrides.status ?? 'ACTIVE',
      roles: overrides.roles ?? ['CUSTOMER'],
      failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      lastLoginAt: overrides.lastLoginAt ?? null,
      emailVerifiedAt: overrides.emailVerifiedAt ?? new Date('2026-01-01T00:00:00.000Z'),
      mustChangePassword: overrides.mustChangePassword ?? false,
      locale: overrides.locale ?? 'es',
      createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    };

    this.users.set(user.id, user);

    return { ...user };
  }

  private isDeleted(user: StoredUser): boolean {
    return (user as { deletedAt?: Date }).deletedAt !== undefined;
  }
}

interface StoredSession extends Mutable<SessionRecord> {
  userAgent: string | null;
  ipAddress: string | null;
  lastUsedAt: Date | null;
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly byHash = new Map<string, string>();

  public async create(input: NewSession): Promise<SessionRecord> {
    const created: StoredSession = {
      id: randomUUID(),
      userId: input.userId,
      familyId: input.familyId,
      replacedById: null,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedReason: null,
      rotatedAt: null,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      lastUsedAt: input.now,
    };

    this.sessions.set(created.id, created);
    this.byHash.set(created.refreshTokenHash, created.id);

    return { ...created };
  }

  public async findByRefreshTokenHash(hash: string): Promise<SessionRecord | null> {
    const id = this.byHash.get(hash);
    if (id === undefined) return null;

    const session = this.sessions.get(id);
    return session === undefined ? null : { ...session };
  }

  public async findById(id: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(id);
    return session === undefined ? null : { ...session };
  }

  public async rotate(input: {
    sessionId: string;
    replacement: NewSession;
    now: Date;
  }): Promise<{ rotated: SessionRecord } | { reuseDetected: true }> {
    const current = this.sessions.get(input.sessionId);

    if (current === undefined || current.revokedAt !== null || current.rotatedAt !== null) {
      return { reuseDetected: true };
    }

    current.rotatedAt = input.now;
    current.revokedAt = input.now;
    current.revokedReason = 'ROTATED';

    const replacement: StoredSession = {
      id: randomUUID(),
      userId: input.replacement.userId,
      familyId: input.replacement.familyId,
      replacedById: null,
      refreshTokenHash: input.replacement.refreshTokenHash,
      expiresAt: input.replacement.expiresAt,
      revokedAt: null,
      revokedReason: null,
      rotatedAt: null,
      userAgent: input.replacement.userAgent,
      ipAddress: input.replacement.ipAddress,
      lastUsedAt: input.now,
    };

    current.replacedById = replacement.id;
    this.sessions.set(replacement.id, replacement);
    this.byHash.set(replacement.refreshTokenHash, replacement.id);

    return { rotated: { ...replacement } };
  }

  public async revoke(input: {
    sessionId: string;
    now: Date;
    reason: SessionRecord['revokedReason'];
  }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (session === undefined || session.revokedAt !== null) return;

    session.revokedAt = input.now;
    session.revokedReason = input.reason;
  }

  public async revokeFamily(input: {
    familyId: string;
    now: Date;
    reason: SessionRecord['revokedReason'];
  }): Promise<number> {
    let revoked = 0;

    for (const session of this.sessions.values()) {
      if (session.familyId !== input.familyId || session.revokedAt !== null) continue;

      session.revokedAt = input.now;
      session.revokedReason = input.reason;
      revoked += 1;
    }

    return revoked;
  }

  public async revokeAllForUser(input: {
    userId: string;
    now: Date;
    reason: SessionRecord['revokedReason'];
  }): Promise<number> {
    let revoked = 0;

    for (const session of this.sessions.values()) {
      if (session.userId !== input.userId || session.revokedAt !== null) continue;

      session.revokedAt = input.now;
      session.revokedReason = input.reason;
      revoked += 1;
    }

    return revoked;
  }

  public async touch(input: { sessionId: string; now: Date }): Promise<void> {
    const session = this.sessions.get(input.sessionId);
    if (session === undefined) return;

    session.lastUsedAt = input.now;
  }

  /** Test helper: every live session, for assertions. */
  public live(): readonly SessionRecord[] {
    return [...this.sessions.values()].filter((session) => session.revokedAt === null);
  }
}

interface StoredResetToken extends Mutable<PasswordResetTokenRecord> {
  tokenHash: string;
}

export class InMemoryPasswordResetTokenRepository implements PasswordResetTokenRepository {
  private readonly tokens = new Map<string, StoredResetToken>();

  /** Test helper: tokens that could still be redeemed. */
  public liveCount(): number {
    return [...this.tokens.values()].filter((token) => token.usedAt === null).length;
  }

  public async create(input: PasswordResetTokenInput): Promise<PasswordResetTokenRecord> {
    const created: StoredResetToken = {
      id: randomUUID(),
      userId: input.userId,
      expiresAt: input.expiresAt,
      usedAt: null,
      tokenHash: input.tokenHash,
    };

    this.tokens.set(created.id, created);

    return { ...created };
  }

  public async consumeByHash(input: {
    tokenHash: string;
    now: Date;
  }): Promise<PasswordResetTokenRecord | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash !== input.tokenHash) continue;
      if (token.usedAt !== null) return null;
      if (token.expiresAt.getTime() <= input.now.getTime()) return null;

      token.usedAt = input.now;

      return { ...token };
    }

    return null;
  }

  public async invalidateAllForUser(userId: string, now: Date): Promise<number> {
    let invalidated = 0;

    for (const token of this.tokens.values()) {
      if (token.userId !== userId || token.usedAt !== null) continue;

      token.usedAt = now;
      invalidated += 1;
    }

    return invalidated;
  }
}

export class InMemoryRiskEventRepository implements RiskEventRepository {
  public readonly events: RiskEventInput[] = [];

  public async record(input: RiskEventInput): Promise<void> {
    this.events.push(input);
  }
}

/**
 * Records what the service asked to deliver, without sending anything.
 *
 * It keeps the raw token so a test can complete a recovery the way a customer
 * would, using the link they received. Production adapters hand the token to a
 * notification provider instead; neither of them writes it anywhere else.
 */
export class RecordingPasswordRecoveryNotifier implements PasswordRecoveryNotifier {
  public readonly delivered: { userId: string; email: string; token: string; expiresAt: Date }[] =
    [];

  public deliver(input: {
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    locale: string;
  }): Promise<void> {
    this.delivered.push(input);

    return Promise.resolve();
  }

  /** The token of the most recent delivery, or undefined if there was none. */
  public lastToken(): string | undefined {
    return this.delivered.at(-1)?.token;
  }
}

/** Records verification codes. Separate from recovery so a test cannot confuse them. */
export class RecordingEmailVerificationNotifier implements EmailVerificationNotifier {
  public readonly delivered: { userId: string; email: string; token: string; expiresAt: Date }[] =
    [];

  /** Set by a test to simulate a provider that refused the message. */
  public failWith: Error | null = null;

  public deliver(input: {
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    locale: string;
  }): Promise<void> {
    if (this.failWith !== null) return Promise.reject(this.failWith);

    this.delivered.push(input);

    return Promise.resolve();
  }

  public lastToken(): string | undefined {
    return this.delivered.at(-1)?.token;
  }
}

interface StoredVerificationToken extends Mutable<VerificationTokenRecord> {
  type: VerificationTokenKind;
  tokenHash: string;
}

export class InMemoryVerificationTokenRepository implements VerificationTokenRepository {
  private readonly tokens = new Map<string, StoredVerificationToken>();

  /** Test helper: codes that could still be redeemed. */
  public liveCount(type?: VerificationTokenKind): number {
    return [...this.tokens.values()].filter(
      (token) => token.usedAt === null && (type === undefined || token.type === type),
    ).length;
  }

  public async create(input: {
    userId: string;
    type: VerificationTokenKind;
    tokenHash: string;
    destination: string;
    expiresAt: Date;
    now: Date;
  }): Promise<VerificationTokenRecord> {
    const created: StoredVerificationToken = {
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      tokenHash: input.tokenHash,
      destination: input.destination,
      expiresAt: input.expiresAt,
      usedAt: null,
    };

    this.tokens.set(created.id, created);

    return { ...created };
  }

  public async consumeByHash(input: {
    tokenHash: string;
    type: VerificationTokenKind;
    now: Date;
  }): Promise<VerificationTokenRecord | null> {
    for (const token of this.tokens.values()) {
      if (token.tokenHash !== input.tokenHash) continue;
      // A code issued for another purpose must not satisfy this one, which is
      // why the type is compared rather than trusted from the caller.
      if (token.type !== input.type) return null;
      if (token.usedAt !== null) return null;
      if (token.expiresAt.getTime() <= input.now.getTime()) return null;

      token.usedAt = input.now;

      return { ...token };
    }

    return null;
  }

  public async invalidateForUser(input: {
    userId: string;
    type: VerificationTokenKind;
    now: Date;
  }): Promise<number> {
    let invalidated = 0;

    for (const token of this.tokens.values()) {
      if (token.userId !== input.userId || token.type !== input.type) continue;
      if (token.usedAt !== null) continue;

      token.usedAt = input.now;
      invalidated += 1;
    }

    return invalidated;
  }
}
