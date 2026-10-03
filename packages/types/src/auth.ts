import type { CurrencyCode, IsoDateTime, Uuid } from './api.js';

/**
 * Authentication wire contracts (ADR-002, docs/API_RULES.md).
 *
 * Tokens are transported in the response body, not in cookies: the platform has
 * native mobile clients where cookie-based sessions are awkward, and the admin
 * panel talks to the API cross-origin with credentials disabled.
 *
 * `accessToken` is a short-lived JWT. `refreshToken` is an opaque random value;
 * only its hash is stored server-side, so it can be revoked immediately.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  /** Access token lifetime in seconds, so a client can refresh proactively. */
  expiresIn: number;
  accessTokenExpiresAt: IsoDateTime;
}

export interface AuthenticatedUser {
  id: Uuid;
  email: string;
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  roles: readonly string[];
  locale: string;
  currency?: CurrencyCode;
  /** Null until the address is verified, which requires a delivered code. */
  emailVerifiedAt: IsoDateTime | null;
  mustChangePassword: boolean;
  createdAt: IsoDateTime;
}

export interface AuthSessionResponse {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}

export interface LogoutRequest {
  refreshToken: string;
}

/**
 * Answer to registration.
 *
 * `tokens` is null when the deployment requires email verification: the account
 * exists but must not receive a session before it is verified, so the client is
 * told to wait for the message instead of being logged in.
 */
export interface RegisterResponse {
  user: AuthenticatedUser;
  tokens: AuthTokens | null;
  verificationRequired: boolean;
}

export interface PasswordRecoveryResult {
  status: 'reset';
}

/**
 * Answer to a successful address verification.
 *
 * `canSignIn` is separate from `verified` because the two are different facts. A
 * deployment can require verification *and* an administrator approval, in which
 * case the address is proven and the account is still not usable. Reporting only
 * `verified` would leave a client showing a sign-in form that cannot work.
 */
export interface EmailConfirmationResult {
  verified: boolean;
  canSignIn: boolean;
}

export interface SessionSummary {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: IsoDateTime;
  lastUsedAt: IsoDateTime | null;
  current: boolean;
}

/**
 * Answer to a password recovery request.
 *
 * Always the same shape whether or not the account exists, so the endpoint
 * cannot be used to enumerate registered addresses.
 */
export interface PasswordRecoveryAccepted {
  status: 'accepted';
}
