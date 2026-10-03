import { Module, type Provider } from '@nestjs/common';
import type { NotificationProvider } from '@deliveryuy/notifications';
import { AppConfigModule } from '../../common/config/app-config.module.js';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { NotificationModule } from '../../common/notifications/notification.module.js';
import { NOTIFICATION_PROVIDER } from '../../common/notifications/notification.tokens.js';
import { DatabaseModule } from '../../common/database/database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  CLOCK,
  EMAIL_VERIFICATION_NOTIFIER,
  PASSWORD_RECOVERY_NOTIFIER,
  PASSWORD_RESET_TOKEN_REPOSITORY,
  RISK_EVENT_REPOSITORY,
  SESSION_REPOSITORY,
  systemClock,
  USER_REPOSITORY,
  VERIFICATION_TOKEN_REPOSITORY,
} from './auth.tokens.js';
import { PrismaPasswordResetTokenRepository } from './infrastructure/prisma-password-reset-token.repository.js';
import { PrismaRiskEventRepository } from './infrastructure/prisma-risk-event.repository.js';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { PrismaVerificationTokenRepository } from './infrastructure/prisma-verification-token.repository.js';
import {
  SmtpEmailVerificationNotifier,
  SmtpPasswordRecoveryNotifier,
} from './infrastructure/smtp-code-delivery.notifiers.js';
import { UnavailableCodeDeliveryNotifier } from './infrastructure/unavailable-code-delivery.notifier.js';
import type { PasswordRecoveryNotifier } from './ports.js';

/**
 * Authentication module.
 *
 * The service depends on the port interfaces; the adapters are bound to the
 * tokens here, in one place, so a test can swap in in-memory stores by
 * overriding a provider and nothing else changes.
 *
 * The notifiers are chosen from the configured provider: SMTP gets the real
 * delivery path, `none` gets an adapter that records the gap instead of
 * pretending. Both satisfy the same ports, so `AuthService` has no idea which
 * one it received and switching providers is a restart with new variables.
 */
/**
 * Builds one notifier binding for whichever port is asked for.
 *
 * One function instead of two inline factories, because the decision is the
 * same and a copy that drifted would send a recovery message through the
 * verification template.
 */
function notifierBinding(
  token: typeof PASSWORD_RECOVERY_NOTIFIER | typeof EMAIL_VERIFICATION_NOTIFIER,
  real: new (provider: NotificationProvider) => PasswordRecoveryNotifier,
): Provider {
  return {
    provide: token,
    inject: [AppConfigService, NOTIFICATION_PROVIDER],
    useFactory: (config: AppConfigService, provider: NotificationProvider) =>
      config.providers.notification.provider === 'smtp'
        ? new real(provider)
        : new UnavailableCodeDeliveryNotifier(),
  };
}

@Module({
  imports: [AppConfigModule, DatabaseModule, SecurityModule, NotificationModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: CLOCK, useValue: systemClock },
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    {
      provide: PASSWORD_RESET_TOKEN_REPOSITORY,
      useClass: PrismaPasswordResetTokenRepository,
    },
    { provide: RISK_EVENT_REPOSITORY, useClass: PrismaRiskEventRepository },
    { provide: VERIFICATION_TOKEN_REPOSITORY, useClass: PrismaVerificationTokenRepository },
    notifierBinding(PASSWORD_RECOVERY_NOTIFIER, SmtpPasswordRecoveryNotifier),
    notifierBinding(EMAIL_VERIFICATION_NOTIFIER, SmtpEmailVerificationNotifier),
  ],
  exports: [AuthService],
})
export class AuthModule {}
