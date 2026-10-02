/**
 * Auth persistence ports.
 *
 * The application service depends on these interfaces, never on Prisma. Two
 * reasons: the security rules (rotation, reuse detection, lockout) become unit
 * testable without infrastructure, and a second storage implementation cannot
 * silently bypass them (AGENTS.md sections 80, 82).
 */

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface AuthUserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly status: UserStatus;
  readonly roles: readonly string[];
  readonly failedLoginAttempts: number;
  /** Set while the account is locked out after repeated failures. */
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly emailVerifiedAt: Date | null;
  readonly mustChangePassword: boolean;
  readonly locale: string;
  readonly createdAt: Date;
}

export interface UserRepository {
  /** Never returns a soft-deleted row: `deletedAt` is filtered by the adapter. */
  findByEmail(email: string): Promise<AuthUserRecord | null>;
  findById(id: string): Promise<AuthUserRecord | null>;
  createCustomer(input: {
    email: string;
    passwordHash: string;
    role: string;
    status: UserStatus;
    now: Date;
  }): Promise<AuthUserRecord>;
  /**
   * Records a failed attempt and applies the lock.
   *
   * The counter and the decision must be atomic, otherwise concurrent attempts
   * can each read the same count and never reach the threshold.
   */
  registerFailedLogin(input: {
    userId: string;
    now: Date;
    maxAttempts: number;
    lockUntil: Date | null;
  }): Promise<void>;
  /** Clears the failure counter and stamps the login. */
  registerSuccessfulLogin(input: { userId: string; now: Date }): Promise<void>;
  /** Replaces the password hash, used after a rehash or a password reset. */
  updatePasswordHash(input: { userId: string; passwordHash: string; now: Date }): Promise<void>;
  /**
   * Records email verification.
   *
   * `activate` lets the deployment decide what happens next: with verification
   * required, the account stays pending until an administrator (or the future
   * verification endpoint) approves it; without it, the account becomes usable.
   */
  markEmailVerified(input: { userId: string; now: Date; activate: boolean }): Promise<void>;
}

export interface NewSession {
  readonly userId: string;
  readonly familyId: string;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly now: Date;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly replacedById: string | null;
  readonly refreshTokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
  readonly rotatedAt: Date | null;
}

export type SessionRevokeReason =
  | 'ROTATED'
  | 'USER_LOGOUT'
  | 'LOGOUT_ALL'
  | 'PASSWORD_RESET'
  | 'REUSE_DETECTED'
  | 'ADMIN_REVOCATION'
  | 'EXPIRED';

export interface SessionRepository {
  create(input: NewSession): Promise<SessionRecord>;
  findByRefreshTokenHash(hash: string): Promise<SessionRecord | null>;
  findById(id: string): Promise<SessionRecord | null>;
  /**
   * Rotates a session atomically.
   *
   * Implemented as a single transaction that re-reads the row: if two clients
   * refresh simultaneously, only one may win and the other must be reported as a
   * reuse, otherwise the second creates a second live session from one token.
   */
  rotate(input: {
    sessionId: string;
    replacement: NewSession;
    now: Date;
  }): Promise<{ rotated: SessionRecord } | { reuseDetected: true }>;
  revoke(input: { sessionId: string; now: Date; reason: SessionRevokeReason }): Promise<void>;
  /** Revokes every session of a family. Reuse detection depends on this. */
  revokeFamily(input: {
    familyId: string;
    now: Date;
    reason: SessionRevokeReason;
  }): Promise<number>;
  revokeAllForUser(input: {
    userId: string;
    now: Date;
    reason: SessionRevokeReason;
  }): Promise<number>;
  touch(input: { sessionId: string; now: Date }): Promise<void>;
}

/** Neutral operational signal, never an accusation (AGENTS.md section 91). */
export interface RiskEventInput {
  readonly subjectType: 'user' | 'session' | 'order' | 'payment';
  readonly subjectId: string;
  readonly type: string;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly metadata?: Record<string, unknown>;
}

export interface RiskEventRepository {
  record(input: RiskEventInput): Promise<void>;
}

export interface PasswordResetTokenInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly requestedIp: string | null;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface PasswordResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
}

export interface PasswordResetTokenRepository {
  create(input: PasswordResetTokenInput): Promise<PasswordResetTokenRecord>;
  /** Returns the token only when it is unused and unexpired. */
  consumeByHash(input: { tokenHash: string; now: Date }): Promise<PasswordResetTokenRecord | null>;
  /** Invalidates every outstanding token of an account. */
  invalidateAllForUser(userId: string, now: Date): Promise<number>;
}

/**
 * Delivery of the password recovery message.
 *
 * A port rather than an inline email: the notification provider arrives in its
 * own phase (AGENTS.md section 60).
 *
 * The raw token travels through this port because the message has to contain it:
 * the delivery channel is the only place where the plaintext token exists, which
 * is the same property as the customer's own screen. An implementation must
 * therefore send it and never log it, store it, or echo it back (SECURITY.md
 * "Logging"). Everywhere else only the SHA-256 hash exists.
 */
export interface PasswordRecoveryNotifier {
  deliver(input: { userId: string; email: string; token: string; expiresAt: Date }): Promise<void>;
}

/** Client context recorded with a session. */
export interface RequestContext {
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
}
