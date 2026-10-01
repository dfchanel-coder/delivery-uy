/**
 * NotificationProvider - ARCHITECTURE.md section 11.
 *
 * Providers are invoked from background jobs. A notification failure is
 * recorded and retried; it must never roll back or block an order transition
 * (AGENTS.md section 23).
 */

export const NOTIFICATION_CHANNELS = ['PUSH', 'EMAIL', 'SMS', 'WHATSAPP'] as const;
export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

export interface NotificationMessage {
  readonly channel: NotificationChannelName;
  readonly templateKey: string;
  readonly recipient: string;
  readonly locale: string;
  readonly data: Readonly<Record<string, string | number | boolean>>;
  /** Correlation identifier for tracing and de-duplication. */
  readonly idempotencyKey: string;
}

export interface NotificationSendResult {
  readonly provider: string;
  readonly channel: NotificationChannelName;
  readonly providerMessageId?: string;
  readonly accepted: boolean;
  readonly error?: string;
}

export interface NotificationProvider {
  getName(): string;
  supports(channel: NotificationChannelName): boolean;
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}

export class NotificationProviderNotConfiguredError extends Error {
  public constructor() {
    super('Notification provider is not configured');
    this.name = 'NotificationProviderNotConfiguredError';
  }
}
