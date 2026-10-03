import { Logger } from '@nestjs/common';
import {
  NodemailerMailTransport,
  SmtpNotificationProvider,
  UnconfiguredNotificationProvider,
  type NotificationProvider,
} from '@deliveryuy/notifications';
import type { AppConfigService } from '../config/app-config.service.js';

/**
 * Turns validated configuration into a provider.
 *
 * Separated from the module so the decision is testable without Nest, and so the
 * module file reads as wiring rather than as a factory.
 */
export class ProviderFactory {
  private static readonly logger = new Logger(ProviderFactory.name);

  public static create(config: AppConfigService): NotificationProvider {
    const notification = config.providers.notification;

    if (notification.provider !== 'smtp') {
      // `fcm` is accepted by the schema for push, which PHASE 03 does not need;
      // it must not silently resolve to something that cannot send email.
      this.logger.warn(
        `Notification provider "${notification.provider}" cannot deliver email: ` +
          'password recovery and address verification will not send a message.',
      );

      return new UnconfiguredNotificationProvider();
    }

    // The schema already proved these exist when the provider is `smtp`, so the
    // assertion is unreachable rather than defensive.
    const smtp = notification.smtp;

    if (smtp === undefined || notification.from === undefined) {
      throw new Error(
        'NOTIFICATION_PROVIDER is "smtp" but the SMTP settings are missing; the configuration schema should have refused this',
      );
    }

    return new SmtpNotificationProvider(
      new NodemailerMailTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTls: smtp.requireTls,
        ...(smtp.user !== undefined && smtp.password !== undefined
          ? { user: smtp.user, password: smtp.password }
          : {}),
      }),
      { from: notification.from },
    );
  }
}
