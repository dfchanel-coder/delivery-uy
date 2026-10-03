import { Injectable, Logger } from '@nestjs/common';
import type { EmailVerificationNotifier, PasswordRecoveryNotifier } from '../ports.js';

/**
 * The `NOTIFICATION_PROVIDER=none` state, as a working implementation.
 *
 * It does what the configuration says: nothing leaves the process. What it does
 * not do is pretend, which is why every attempt produces a log line naming the
 * variables that would fix it.
 *
 * The token is still created and hashed by the service either way, and the
 * account state is correct, so switching a provider on changes delivery and
 * nothing else. Only the token and the account id are logged, never the code
 * (SECURITY.md "Logging").
 */
@Injectable()
export class UnavailableCodeDeliveryNotifier
  implements PasswordRecoveryNotifier, EmailVerificationNotifier
{
  private readonly logger = new Logger(UnavailableCodeDeliveryNotifier.name);

  public async deliver(input: {
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
    locale: string;
  }): Promise<void> {
    this.logger.warn(
      `One-time code created for account ${input.userId} but not delivered: ` +
        'no notification provider is configured. Set NOTIFICATION_PROVIDER=smtp together with ' +
        'SMTP_HOST, SMTP_PORT and SMTP_FROM.',
    );

    // Resolved, not rejected: the caller did start a recovery, and reporting a
    // failure here would tell it something untrue (AGENTS.md section 23).
    await Promise.resolve();
  }
}
