import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  checkPasswordPolicy,
  generateOpaqueToken,
  hashPassword,
  passwordNeedsRehash,
  sha256Hex,
  TOKEN_PREFIX_PASSWORD_RESET,
  TOKEN_PREFIX_REFRESH,
  TOKEN_PREFIX_VERIFICATION,
  verifyPasswordOrDummy,
  type Argon2Parameters,
} from '@deliveryuy/auth';
import { parseDurationToMs } from '@deliveryuy/config';
import { ERROR_CODES } from '@deliveryuy/types';
import type {
  AuthSessionResponse,
  AuthTokens,
  AuthenticatedUser,
  EmailConfirmationResult,
  PasswordRecoveryResult,
  RegisterResponse,
} from '@deliveryuy/types';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { AccessTokenService } from '../../common/security/security.module.js';
import {
  CLOCK,
  EMAIL_VERIFICATION_NOTIFIER,
  PASSWORD_RECOVERY_NOTIFIER,
  PASSWORD_RESET_TOKEN_REPOSITORY,
  RISK_EVENT_REPOSITORY,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  VERIFICATION_TOKEN_REPOSITORY,
  type Clock,
} from './auth.tokens.js';
import type {
  AuthUserRecord,
  EmailVerificationNotifier,
  PasswordRecoveryNotifier,
  PasswordResetTokenRepository,
  RequestContext,
  RiskEventRepository,
  SessionRecord,
  SessionRepository,
  UserRepository,
  VerificationTokenRepository,
} from './ports.js';

/**
 * Authentication and session lifecycle (ADR-002, SECURITY.md).
 *
 * Security rules live here, not in the controller and not in the adapters:
 * - passwords are hashed with Argon2id and never logged;
 * - login verification costs the same whether or not the account exists;
 * - refresh tokens rotate on every use and reuse revokes the whole family;
 * - a password reset revokes every existing session.
 *
 * The controller only parses and validates input (AGENTS.md section 81).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  public constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(PASSWORD_RESET_TOKEN_REPOSITORY)
    private readonly resetTokens: PasswordResetTokenRepository,
    @Inject(RISK_EVENT_REPOSITORY) private readonly riskEvents: RiskEventRepository,
    @Inject(PASSWORD_RECOVERY_NOTIFIER) private readonly notifier: PasswordRecoveryNotifier,
    @Inject(EMAIL_VERIFICATION_NOTIFIER)
    private readonly verificationNotifier: EmailVerificationNotifier,
    @Inject(VERIFICATION_TOKEN_REPOSITORY)
    private readonly verificationTokens: VerificationTokenRepository,
    private readonly accessTokens: AccessTokenService,
    private readonly config: AppConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- register

  public async register(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<RegisterResponse> {
    const email = normalizeEmail(input.email);
    this.assertCredentialsPresent(input.email, input.password);
    this.assertPasswordPolicy(input.password);

    const existing = await this.users.findByEmail(email);

    if (existing !== null) {
      throw new ApiException(
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'An account already exists for this email address.',
      );
    }

    const now = this.clock.now();
    const passwordHash = await hashPassword(input.password, this.argon2());
    const verificationRequired = this.config.auth.requireEmailVerification;

    const user = await this.users.createCustomer({
      email,
      passwordHash,
      role: this.config.auth.registerDefaultRole,
      status: verificationRequired ? 'PENDING_VERIFICATION' : 'ACTIVE',
      now,
    });

    // A pending account gets no session: handing one out would let an
    // unverified address act on the platform.
    if (verificationRequired) {
      await this.startEmailVerification(user);
      this.logger.log(`Registered account awaiting email verification (${user.id})`);
      return { user: toWireUser(user), tokens: null, verificationRequired: true };
    }

    return {
      user: toWireUser(user),
      tokens: await this.startSession(user, context),
      verificationRequired: false,
    };
  }

  /**
   * Issues a verification code and hands it to the delivery channel.
   *
   * Any earlier outstanding code is invalidated first, so a forwarded message
   * cannot be used after the recipient asks for a new one. Without it, several
   * valid codes for one account would each confirm the same address, which makes
   * "this is the only one that works" impossible to reason about.
   */
  private async startEmailVerification(user: AuthUserRecord): Promise<void> {
    const now = this.clock.now();

    await this.verificationTokens.invalidateForUser({
      userId: user.id,
      type: 'EMAIL_VERIFY',
      now,
    });

    const { raw, hash } = generateOpaqueToken(TOKEN_PREFIX_VERIFICATION);
    const expiresAt = new Date(now.getTime() + this.emailVerificationTtlHours() * 3_600_000);

    await this.verificationTokens.create({
      userId: user.id,
      type: 'EMAIL_VERIFY',
      tokenHash: hash,
      destination: user.email,
      expiresAt,
      now,
    });

    // The raw code goes to the delivery channel and nowhere else. A provider
    // that throws is contained here: the account exists, the code is hashed and
    // valid, and failing the registration now would tell the customer their
    // account was not created when it was (AGENTS.md section 23).
    try {
      await this.verificationNotifier.deliver({
        userId: user.id,
        email: user.email,
        token: raw,
        expiresAt,
        locale: user.locale,
      });
    } catch (error) {
      this.logger.warn(
        `Verification delivery for account ${user.id} failed: ` +
          `${error instanceof Error ? error.name : 'unknown error'}. ` +
          'The account exists and stays pending; nobody has the code yet.',
      );
    }
  }

  // ------------------------------------------------------------------- login

  public async login(
    input: { email: string; password: string },
    context: RequestContext,
  ): Promise<AuthSessionResponse> {
    const email = normalizeEmail(input.email);
    this.assertCredentialsPresent(input.email, input.password);

    const now = this.clock.now();
    const user = await this.users.findByEmail(email);

    // The verification runs even when the account does not exist, so a wrong
    // address and a wrong password take the same time.
    const passwordMatches = await verifyPasswordOrDummy(
      user?.passwordHash ?? null,
      input.password,
      this.argon2(),
    );

    if (user === null || !passwordMatches) {
      if (user !== null) {
        await this.recordFailedLogin(user, now);
      }

      throw new ApiException(
        ERROR_CODES.INVALID_CREDENTIALS,
        'Email or password is incorrect.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.assertUsable(user, now);

    if (passwordNeedsRehash(user.passwordHash, this.argon2())) {
      // The plaintext is available only here, so this is the one moment the
      // stored hash can be upgraded to the current cost.
      const upgraded = await hashPassword(input.password, this.argon2());
      await this.users.updatePasswordHash({ userId: user.id, passwordHash: upgraded, now });
    }

    await this.users.registerSuccessfulLogin({ userId: user.id, now });

    return {
      user: toWireUser(user),
      tokens: await this.startSession(user, context),
    };
  }

  /** Reason a login is refused, so the message never contradicts the record. */
  private assertUsable(user: AuthUserRecord, now: Date): void {
    if (user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime()) {
      throw new ApiException(
        ERROR_CODES.ACCOUNT_LOCKED,
        'Too many failed attempts. Try again later.',
        { lockedUntil: user.lockedUntil.toISOString() },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (user.status === 'DISABLED') {
      throw new ApiException(
        ERROR_CODES.ACCOUNT_DISABLED,
        'This account has been disabled.',
        undefined,
        HttpStatus.FORBIDDEN,
      );
    }

    if (user.status === 'SUSPENDED') {
      throw new ApiException(
        ERROR_CODES.ACCOUNT_SUSPENDED,
        'This account is suspended.',
        undefined,
        HttpStatus.FORBIDDEN,
      );
    }

    if (
      user.status === 'PENDING_VERIFICATION' ||
      (this.config.auth.requireEmailVerification && user.emailVerifiedAt === null)
    ) {
      throw new ApiException(
        ERROR_CODES.EMAIL_NOT_VERIFIED,
        'Verify your email address before signing in.',
        undefined,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private async recordFailedLogin(user: AuthUserRecord, now: Date): Promise<void> {
    const { loginMaxAttempts, loginLockMinutes } = this.config.auth;
    const alreadyLocked = user.lockedUntil !== null && user.lockedUntil.getTime() > now.getTime();
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = !alreadyLocked && attempts >= loginMaxAttempts;

    await this.users.registerFailedLogin({
      userId: user.id,
      now,
      maxAttempts: loginMaxAttempts,
      lockUntil: shouldLock
        ? new Date(now.getTime() + loginLockMinutes * 60_000)
        : (user.lockedUntil ?? null),
    });

    if (shouldLock) {
      this.logger.warn(`Account ${user.id} locked after ${attempts} failed attempts`);
      await this.riskEvents.record({
        subjectType: 'user',
        subjectId: user.id,
        type: 'auth.account_locked',
        severity: 'LOW',
        metadata: { attempts },
      });
    }
  }

  // ----------------------------------------------------------------- refresh

  public async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<AuthSessionResponse> {
    const raw = this.assertOpaqueToken(refreshToken);
    const now = this.clock.now();
    const session = await this.sessions.findByRefreshTokenHash(sha256Hex(raw));

    if (session === null) {
      throw new ApiException(
        ERROR_CODES.TOKEN_INVALID,
        'Refresh token is not recognised.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (session.revokedAt !== null) {
      return this.handleRevokedSession(session);
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.sessions.revoke({ sessionId: session.id, now, reason: 'EXPIRED' });
      throw new ApiException(
        ERROR_CODES.TOKEN_EXPIRED,
        'Session has expired. Sign in again.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.users.findById(session.userId);

    if (user === null) {
      await this.sessions.revoke({ sessionId: session.id, now, reason: 'ADMIN_REVOCATION' });
      throw new ApiException(
        ERROR_CODES.TOKEN_REVOKED,
        'Session is no longer valid.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.assertUsable(user, now);

    const rotatedToken = generateOpaqueToken(TOKEN_PREFIX_REFRESH);
    const replacement = await this.sessions.rotate({
      sessionId: session.id,
      replacement: {
        userId: session.userId,
        familyId: session.familyId,
        refreshTokenHash: rotatedToken.hash,
        expiresAt: new Date(now.getTime() + this.refreshLifetimeMs()),
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        now,
      },
      now,
    });

    if ('reuseDetected' in replacement) {
      // Two clients presented the same token: one of them is replaying it, so
      // the entire family goes down (SECURITY.md "Password and Token
      // Parameters"). The legitimate client is logged out too, deliberately.
      return this.handleReuse(session);
    }

    const rotated = replacement.rotated;
    await this.sessions.touch({ sessionId: rotated.id, now });

    const accessToken = await this.accessTokens.issue({
      subject: user.id,
      sessionId: rotated.id,
      roles: user.roles,
    });

    return {
      user: toWireUser(user),
      tokens: {
        accessToken: accessToken.token,
        refreshToken: rotatedToken.raw,
        tokenType: 'Bearer',
        expiresIn: Math.max(
          0,
          Math.floor((accessToken.expiresAt.getTime() - now.getTime()) / 1000),
        ),
        accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
      },
    };
  }

  /**
   * A revoked token presented again.
   *
   * `ROTATED` means the token was already exchanged, so this is reuse. Any other
   * reason is an ordinary revoked session (logout, reset, administrative
   * revocation) and is reported as such.
   */
  private async handleRevokedSession(session: SessionRecord): Promise<never> {
    if (session.revokedReason === 'ROTATED') {
      return this.handleReuse(session);
    }

    throw new ApiException(
      ERROR_CODES.TOKEN_REVOKED,
      'Session has been closed. Sign in again.',
      undefined,
      HttpStatus.UNAUTHORIZED,
    );
  }

  private async handleReuse(session: SessionRecord): Promise<never> {
    const now = this.clock.now();

    await this.sessions.revokeFamily({
      familyId: session.familyId,
      now,
      reason: 'REUSE_DETECTED',
    });
    await this.riskEvents.record({
      subjectType: 'session',
      subjectId: session.id,
      type: 'auth.refresh_token_reuse',
      severity: 'HIGH',
      metadata: { familyId: session.familyId },
    });

    this.logger.warn(`Refresh token reuse detected for family ${session.familyId}`);

    throw new ApiException(
      ERROR_CODES.REFRESH_TOKEN_REUSED,
      'Session has been closed for security reasons. Sign in again.',
      undefined,
      HttpStatus.UNAUTHORIZED,
    );
  }

  // ----------------------------------------------------------------- logout

  /**
   * Closes one session.
   *
   * Idempotent: signing out twice, or with an already revoked token, is a
   * success, because the caller's intent ("this session must not be usable") is
   * already satisfied.
   */
  public async logout(refreshToken: string): Promise<void> {
    const raw = this.assertOpaqueToken(refreshToken);
    const session = await this.sessions.findByRefreshTokenHash(sha256Hex(raw));

    if (session === null || session.revokedAt !== null) return;

    await this.sessions.revoke({
      sessionId: session.id,
      now: this.clock.now(),
      reason: 'USER_LOGOUT',
    });
  }

  /** Closes every session of the caller: the "sign out everywhere" action. */
  public async logoutEverywhere(userId: string): Promise<number> {
    return this.sessions.revokeAllForUser({
      userId,
      now: this.clock.now(),
      reason: 'LOGOUT_ALL',
    });
  }

  public async currentUser(userId: string): Promise<AuthenticatedUser> {
    const user = await this.users.findById(userId);

    if (user === null) {
      throw ApiException.notFound(ERROR_CODES.NOT_FOUND, 'Account no longer exists.');
    }

    return toWireUser(user);
  }

  // ------------------------------------------------------- password recovery

  /**
   * Starts password recovery.
   *
   * The answer is identical for a known and an unknown address: reporting
   * "no such account" would turn this endpoint into an account enumerator.
   */
  public async requestPasswordRecovery(email: string, ipAddress: string | null): Promise<void> {
    const normalized = normalizeEmail(email);
    const user = await this.users.findByEmail(normalized);

    if (user === null) return;

    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.config.auth.passwordResetTtlHours * 3_600_000);
    const { raw, hash } = generateOpaqueToken(TOKEN_PREFIX_PASSWORD_RESET);

    await this.resetTokens.create({
      userId: user.id,
      tokenHash: hash,
      requestedIp: ipAddress,
      expiresAt,
      now,
    });

    // The raw token goes to the delivery channel and nowhere else.
    await this.notifier.deliver({
      userId: user.id,
      email: user.email,
      token: raw,
      expiresAt,
      locale: user.locale,
    });
  }

  /**
   * Completes password recovery.
   *
   * Consumes the token in the same step that changes the password, so it cannot
   * be replayed, and revokes every session: a password reset exists precisely
   * because someone else may hold the old credentials.
   */
  public async completePasswordRecovery(
    token: string,
    password: string,
  ): Promise<PasswordRecoveryResult> {
    const raw = this.assertOpaqueToken(token);
    this.assertPasswordPolicy(password);

    const now = this.clock.now();
    const record = await this.resetTokens.consumeByHash({ tokenHash: sha256Hex(raw), now });

    if (record === null) {
      throw new ApiException(
        ERROR_CODES.TOKEN_INVALID,
        'Recovery code is invalid or has expired.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const passwordHash = await hashPassword(password, this.argon2());
    await this.users.updatePasswordHash({ userId: record.userId, passwordHash, now });
    await this.resetTokens.invalidateAllForUser(record.userId, now);
    await this.sessions.revokeAllForUser({
      userId: record.userId,
      now,
      reason: 'PASSWORD_RESET',
    });

    this.logger.log(`Password reset completed for account ${record.userId}`);

    return { status: 'reset' };
  }

  /**
   * Completes address verification with the code the customer received.
   *
   * The token is consumed in the same step that records the verification, so a
   * link cannot be replayed, and the `destination` on the row is what gets
   * verified: a code issued for one address never activates another.
   *
   * Whether a proven address is enough to sign in is a deployment decision
   * (`ACCOUNT_APPROVAL_REQUIRED`), not a property of the address: with an
   * approval gate the account stays pending, and the answer says so instead of
   * leaving the client to guess.
   */
  public async confirmEmail(token: string): Promise<EmailConfirmationResult> {
    const raw = this.assertOpaqueToken(token);
    const now = this.clock.now();

    const record = await this.verificationTokens.consumeByHash({
      tokenHash: sha256Hex(raw),
      type: 'EMAIL_VERIFY',
      now,
    });

    if (record === null) {
      throw new ApiException(
        ERROR_CODES.TOKEN_INVALID,
        'Verification code is invalid or has expired.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Any other outstanding code for this address stops working: the address is
    // proven, so a second code in an older message is a stale copy at best.
    await this.verificationTokens.invalidateForUser({
      userId: record.userId,
      type: 'EMAIL_VERIFY',
      now,
    });

    await this.users.markEmailVerified({
      userId: record.userId,
      now,
      activate: !this.config.auth.accountApprovalRequired,
    });

    const user = await this.users.findById(record.userId);

    return {
      verified: true,
      // False when the deployment holds the account for approval, and false also
      // when an administrator suspended it in the meantime - reporting the
      // second case is the point: the address is proven and the account is not
      // usable, and the client needs to be told which one it is looking at.
      canSignIn: user !== null && user.status === 'ACTIVE',
    };
  }

  /**
   * Records that the address behind an account was verified.
   *
   * The administrative path, which records the proof without a message being
   * delivered. Whether that also makes the account usable is the same deployment
   * decision the customer-facing path uses, so the two cannot disagree.
   */
  public async verifyEmail(userId: string): Promise<void> {
    await this.users.markEmailVerified({
      userId,
      now: this.clock.now(),
      activate: !this.config.auth.accountApprovalRequired,
    });
  }

  // ------------------------------------------------------------------ shared

  /**
   * Opens a session and mints the first access token.
   *
   * Each login starts a new family: rotation keeps the family stable, so a
   * replayed token can only ever be traced back to one login.
   */
  private async startSession(user: AuthUserRecord, context: RequestContext): Promise<AuthTokens> {
    const now = this.clock.now();
    const { raw, hash } = generateOpaqueToken(TOKEN_PREFIX_REFRESH);
    const expiresAt = new Date(now.getTime() + this.refreshLifetimeMs());

    const session = await this.sessions.create({
      userId: user.id,
      familyId: randomUUID(),
      refreshTokenHash: hash,
      expiresAt,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      now,
    });

    const accessToken = await this.accessTokens.issue({
      subject: user.id,
      sessionId: session.id,
      roles: user.roles,
    });

    return {
      accessToken: accessToken.token,
      refreshToken: raw,
      tokenType: 'Bearer',
      expiresIn: Math.max(0, Math.floor((accessToken.expiresAt.getTime() - now.getTime()) / 1000)),
      accessTokenExpiresAt: accessToken.expiresAt.toISOString(),
    };
  }

  private refreshLifetimeMs(): number {
    return parseDurationToMs(this.config.auth.refreshExpiresIn);
  }

  private emailVerificationTtlHours(): number {
    return this.config.auth.emailVerificationTtlHours;
  }

  private argon2(): Argon2Parameters {
    const { passwordArgon2MemoryKib, passwordArgon2Iterations } = this.config.auth;

    return {
      memoryKib: passwordArgon2MemoryKib,
      iterations: passwordArgon2Iterations,
      parallelism: 1,
    };
  }

  private assertCredentialsPresent(email: string | undefined, password: string | undefined): void {
    if (
      typeof email !== 'string' ||
      email.trim().length === 0 ||
      typeof password !== 'string' ||
      password.length === 0
    ) {
      throw new ApiException(
        ERROR_CODES.CREDENTIALS_INCOMPLETE,
        'Email and password are required.',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private assertPasswordPolicy(password: string): void {
    const problems = checkPasswordPolicy(password, {
      minLength: this.config.auth.passwordMinLength,
    });

    if (problems.length === 0) return;

    throw new ApiException(
      ERROR_CODES.VALIDATION_FAILED,
      'Password does not meet the requirements.',
      { reasons: [...problems] },
      HttpStatus.BAD_REQUEST,
    );
  }

  private assertOpaqueToken(token: string | undefined): string {
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new ApiException(
        ERROR_CODES.CREDENTIALS_INCOMPLETE,
        'Token is required.',
        undefined,
        HttpStatus.BAD_REQUEST,
      );
    }

    return token.trim();
  }
}

/** Addresses are stored and compared lowercased, so casing cannot split an account. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toWireUser(user: AuthUserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    status: user.status,
    roles: [...user.roles],
    locale: user.locale,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
  };
}
