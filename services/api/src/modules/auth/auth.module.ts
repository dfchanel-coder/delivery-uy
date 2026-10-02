import { Module } from '@nestjs/common';
import { AppConfigModule } from '../../common/config/app-config.module.js';
import { DatabaseModule } from '../../common/database/database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import {
  CLOCK,
  PASSWORD_RECOVERY_NOTIFIER,
  PASSWORD_RESET_TOKEN_REPOSITORY,
  RISK_EVENT_REPOSITORY,
  SESSION_REPOSITORY,
  systemClock,
  USER_REPOSITORY,
} from './auth.tokens.js';
import { PrismaPasswordResetTokenRepository } from './infrastructure/prisma-password-reset-token.repository.js';
import { PrismaRiskEventRepository } from './infrastructure/prisma-risk-event.repository.js';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository.js';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository.js';
import { UnavailablePasswordRecoveryNotifier } from './infrastructure/unavailable-password-recovery.notifier.js';

/**
 * Authentication module.
 *
 * The service depends on the port interfaces; the Prisma adapters are bound to
 * the tokens here, in one place, so a test can swap in in-memory stores by
 * overriding a provider and nothing else changes.
 *
 * `UnavailablePasswordRecoveryNotifier` is bound until a notification provider
 * exists. It is the only binding in the platform that stands in for a feature
 * that is not built yet, and it says so in its own name and in its log line.
 */
@Module({
  imports: [AppConfigModule, DatabaseModule, SecurityModule],
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
    { provide: PASSWORD_RECOVERY_NOTIFIER, useClass: UnavailablePasswordRecoveryNotifier },
  ],
  exports: [AuthService],
})
export class AuthModule {}
