import { Injectable, Logger } from '@nestjs/common';
import type { PasswordRecoveryNotifier } from '../ports.js';

/**
 * Records that a recovery message was not delivered.
 *
 * The notification provider belongs to its own phase. Until one is configured,
 * this implementation deliberately does nothing except state the gap: it does
 * not send a fake message, and it never logs the token (SECURITY.md "Logging").
 *
 * The effect is that a token exists, is hashed, expires and is single-use, but
 * the person who requested it never receives it. `requestPasswordRecovery` still
 * answers identically for known and unknown addresses, so nothing is leaked; and
 * `REQUIRE_EMAIL_VERIFICATION` cannot be switched on while the provider is
 * `none`, because the configuration schema refuses that combination.
 *
 * When a provider arrives, this class is replaced by an adapter that hands the
 * raw token to the notification port. The service does not change.
 */
@Injectable()
export class UnavailablePasswordRecoveryNotifier implements PasswordRecoveryNotifier {
  private readonly logger = new Logger(UnavailablePasswordRecoveryNotifier.name);

  public deliver(input: {
    userId: string;
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    this.logger.warn(
      `Password recovery token created for account ${input.userId} but not delivered: ` +
        'no notification provider is configured. Set NOTIFICATION_PROVIDER and replace this adapter.',
    );

    return Promise.resolve();
  }
}
