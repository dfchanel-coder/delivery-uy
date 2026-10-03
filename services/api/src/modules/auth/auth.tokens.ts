import type { InjectionToken } from '@nestjs/common';
import type {
  EmailVerificationNotifier,
  PasswordRecoveryNotifier,
  PasswordResetTokenRepository,
  RiskEventRepository,
  SessionRepository,
  UserRepository,
  VerificationTokenRepository,
} from './ports.js';

/**
 * Injection tokens for the auth ports.
 *
 * The ports themselves are interfaces with no runtime value, so they cannot be
 * used as tokens. Keeping the tokens in one file means the service constructor
 * lists them all in one place, and a test overriding a provider only has to
 * import from here.
 */
export const USER_REPOSITORY: InjectionToken<UserRepository> = 'DELIVERYUY_USER_REPOSITORY';
export const SESSION_REPOSITORY: InjectionToken<SessionRepository> =
  'DELIVERYUY_SESSION_REPOSITORY';
export const PASSWORD_RESET_TOKEN_REPOSITORY: InjectionToken<PasswordResetTokenRepository> =
  'DELIVERYUY_PASSWORD_RESET_TOKEN_REPOSITORY';
export const RISK_EVENT_REPOSITORY: InjectionToken<RiskEventRepository> =
  'DELIVERYUY_RISK_EVENT_REPOSITORY';
export const PASSWORD_RECOVERY_NOTIFIER: InjectionToken<PasswordRecoveryNotifier> =
  'DELIVERYUY_PASSWORD_RECOVERY_NOTIFIER';
export const EMAIL_VERIFICATION_NOTIFIER: InjectionToken<EmailVerificationNotifier> =
  'DELIVERYUY_EMAIL_VERIFICATION_NOTIFIER';
export const VERIFICATION_TOKEN_REPOSITORY: InjectionToken<VerificationTokenRepository> =
  'DELIVERYUY_VERIFICATION_TOKEN_REPOSITORY';

/**
 * Time source.
 *
 * Session expiry, lockouts and token lifetimes are all time-dependent rules.
 * Injected rather than read from `Date.now()` so tests can move the clock
 * deliberately instead of sleeping, and so every timestamp taken during one
 * request shares a single value.
 */
export interface Clock {
  now(): Date;
}

export const CLOCK: InjectionToken<Clock> = 'DELIVERYUY_CLOCK';

export const systemClock: Clock = {
  now: () => new Date(),
};
