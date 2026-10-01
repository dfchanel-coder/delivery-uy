/**
 * PaymentProvider - ADR-003.
 *
 * Money crosses this boundary as a fixed 2-decimal string with an explicit
 * currency. The platform never stores card data; providers return tokens or
 * opaque references (AGENTS.md section 69).
 */

export type PaymentMethodKind = 'ONLINE_CARD' | 'WALLET' | 'CASH' | 'TRANSFER';

export type ProviderPaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'FAILED'
  | 'EXPIRED';

export interface Money {
  /** Fixed 2-decimal string, never a JavaScript number (ADR-008). */
  readonly amount: string;
  readonly currency: string;
}

export interface CreatePaymentRequest {
  readonly reference: string;
  readonly amount: Money;
  readonly method: PaymentMethodKind;
  readonly customerEmail: string;
  readonly idempotencyKey: string;
  readonly callbackUrls?: {
    readonly success?: string;
    readonly failure?: string;
    readonly pending?: string;
  };
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface CreatePaymentResult {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly status: ProviderPaymentStatus;
  /** Where the customer must be redirected, when the provider requires it. */
  readonly redirectUrl?: string;
  readonly expiresAt?: string;
}

export interface ProviderPaymentSnapshot {
  readonly provider: string;
  readonly providerPaymentId: string;
  readonly status: ProviderPaymentStatus;
  readonly paidAmount: Money;
  readonly approvedAt?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface RefundRequest {
  readonly providerPaymentId: string;
  readonly amount: Money;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly providerRefundId: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export interface ProviderWebhookEvent {
  readonly provider: string;
  readonly providerEventId: string;
  readonly eventType: string;
  readonly signatureValid: boolean;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PaymentProvider {
  getName(): string;
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;
  getPayment(providerPaymentId: string): Promise<ProviderPaymentSnapshot>;
  refund(request: RefundRequest): Promise<RefundResult>;
  /**
   * Verifies authenticity and normalises the event. Unverified events must be
   * returned with `signatureValid: false` and must never be processed
   * (AGENTS.md section 18).
   */
  parseWebhookEvent(
    rawBody: Buffer,
    headers: Readonly<Record<string, string>>,
  ): ProviderWebhookEvent;
}

export class PaymentProviderNotConfiguredError extends Error {
  public constructor(provider = 'payment') {
    super(`Payment provider "${provider}" is not configured`);
    this.name = 'PaymentProviderNotConfiguredError';
  }
}
