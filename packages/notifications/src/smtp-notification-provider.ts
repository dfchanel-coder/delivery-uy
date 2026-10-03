import {
  NotificationProviderNotConfiguredError,
  type NotificationChannelName,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationSendResult,
} from './notification-provider.js';
import type { MailTransport } from './mail-transport.js';
import { renderTemplate } from './template.js';
import { resolveTemplate } from './templates.js';

export interface SmtpNotificationProviderOptions {
  /** Envelope sender, e.g. `DeliveryUY <no-reply@deliveryuy.example>`. */
  readonly from: string;
  /**
   * Minimum length for a recipient address.
   *
   * The address is never formatted into the body, but a malformed one makes the
   * server reject the message, and a provider that keeps accepting garbage just
   * moves the failure somewhere less visible.
   */
  readonly minRecipientLength?: number;
}

/**
 * Email over SMTP.
 *
 * `send` resolves with `accepted: false` for a rejected message instead of
 * throwing, because a notification failure must never roll back or block the
 * business operation that triggered it (AGENTS.md section 23). The caller
 * decides whether to retry; this class only reports honestly.
 *
 * A transport that cannot be reached is the same case as a server that refused
 * the message: reported, not raised. Callers that need to fail loudly do so by
 * inspecting `accepted`, which is why the error is in the result.
 */
export class SmtpNotificationProvider implements NotificationProvider {
  private readonly minRecipientLength: number;

  public constructor(
    private readonly transport: MailTransport,
    private readonly options: SmtpNotificationProviderOptions,
  ) {
    this.minRecipientLength = options.minRecipientLength ?? 3;
  }

  public getName(): string {
    return 'smtp';
  }

  public supports(channel: NotificationChannelName): boolean {
    return channel === 'EMAIL';
  }

  public async send(message: NotificationMessage): Promise<NotificationSendResult> {
    if (message.channel !== 'EMAIL') {
      return {
        provider: this.getName(),
        channel: message.channel,
        accepted: false,
        error: `smtp does not carry the ${message.channel} channel`,
      };
    }

    if (message.recipient.trim().length < this.minRecipientLength) {
      return {
        provider: this.getName(),
        channel: message.channel,
        accepted: false,
        error: 'recipient address is not usable',
      };
    }

    try {
      const rendered = renderTemplate(
        resolveTemplate(message.templateKey, message.locale),
        message.data,
        message.locale,
      );

      const { messageId } = await this.transport.send({
        from: this.options.from,
        to: message.recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        idempotencyKey: message.idempotencyKey,
      });

      return {
        provider: this.getName(),
        channel: message.channel,
        providerMessageId: messageId,
        accepted: true,
      };
    } catch (error) {
      // The message body is never interpolated into this string: it carries the
      // recovery token (SECURITY.md "Logging").
      return {
        provider: this.getName(),
        channel: message.channel,
        accepted: false,
        error: error instanceof Error ? error.name : 'unknown notification failure',
      };
    }
  }

  public verify(): Promise<void> {
    return this.transport.verify();
  }

  public close(): void {
    this.transport.close();
  }
}

/**
 * The `none` provider.
 *
 * Refuses every send instead of pretending. Its name, its `supports` answer and
 * its error all say the same thing, so a missing provider is visible at the
 * point of use and not only as a message that never arrived.
 */
export class UnconfiguredNotificationProvider implements NotificationProvider {
  public getName(): string {
    return 'none';
  }

  // Declared without parameters on purpose: this provider answers the same to
  // every channel and has no use for the message. The interface still types the
  // call site, so a caller cannot pass something this silently discards without
  // noticing the provider said no.
  public supports(): boolean {
    return false;
  }

  public send(): Promise<never> {
    return Promise.reject(new NotificationProviderNotConfiguredError());
  }
}
