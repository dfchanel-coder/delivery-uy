import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_PROVIDER } from '../../../common/notifications/notification.tokens.js';
import type { NotificationProvider } from '@deliveryuy/notifications';
import { sha256Hex } from '@deliveryuy/auth';
import type { EmailVerificationNotifier, PasswordRecoveryNotifier } from '../ports.js';

interface DeliveryInput {
  userId: string;
  email: string;
  token: string;
  expiresAt: Date;
  locale: string;
}

/**
 * Hands a one-time code to the notification provider.
 *
 * Shared by recovery and verification because the mechanics are identical: pick
 * a template, send, report. They differ only in the template key and in what
 * each one means, which is why they remain two ports.
 *
 * A failed send resolves. The token was created and hashed, the account state
 * is unchanged, and failing the caller's request would report something untrue
 * while destroying nothing that could be retried (AGENTS.md section 23).
 */
abstract class CodeDeliveryNotifier implements PasswordRecoveryNotifier, EmailVerificationNotifier {
  private readonly logger: Logger;

  protected constructor(
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProvider,
    private readonly templateKey: string,
    private readonly label: string,
  ) {
    this.logger = new Logger(this.constructor.name);
  }

  public async deliver(input: DeliveryInput): Promise<void> {
    const result = await this.provider.send({
      channel: 'EMAIL',
      templateKey: this.templateKey,
      recipient: input.email,
      locale: input.locale,
      data: {
        appName: 'DeliveryUY',
        token: input.token,
        expiresAt: input.expiresAt.toISOString(),
      },
      // Derived from the token hash rather than the token, because this key can
      // reach a mail server header and the token is the credential. Hashing also
      // makes a genuine resend of the same token reuse the same key, which is
      // the point of the field.
      idempotencyKey: `${this.templateKey}:${sha256Hex(input.token)}`,
    });

    if (result.accepted) {
      this.logger.log(
        `${this.label} message accepted for account ${input.userId} by provider "${result.provider}"`,
      );

      return;
    }

    // The body is never interpolated here: it carries the code. The reason is
    // enough for an operator to act on (SECURITY.md "Logging").
    this.logger.warn(
      `${this.label} message for account ${input.userId} was not delivered: ${result.error ?? 'unknown reason'}. ` +
        'The account state is unchanged and the code remains valid until it expires.',
    );
  }
}

@Injectable()
export class SmtpPasswordRecoveryNotifier extends CodeDeliveryNotifier {
  public constructor(@Inject(NOTIFICATION_PROVIDER) provider: NotificationProvider) {
    super(provider, 'password-recovery', 'Password recovery');
  }
}

@Injectable()
export class SmtpEmailVerificationNotifier extends CodeDeliveryNotifier {
  public constructor(@Inject(NOTIFICATION_PROVIDER) provider: NotificationProvider) {
    super(provider, 'email-verification', 'Email verification');
  }
}
