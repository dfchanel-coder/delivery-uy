/**
 * BillingProvider - ARCHITECTURE.md section 11.
 *
 * `LEGAL_REVIEW_REQUIRED`: fiscal document types, numbering series and tax
 * treatment are decided with an accountant and the chosen fiscal provider.
 * Nothing in this interface assumes a specific fiscal regime; adapters only
 * translate a neutral request into provider payloads.
 */

export interface BillingDocumentRequest {
  /** Stable platform identifier, used as the idempotency key. */
  readonly idempotencyKey: string;
  readonly orderCode: string;
  readonly issuedAt: string;
  readonly currency: string;
  readonly total: string;
  readonly subtotal: string;
  readonly taxTotal: string;
  readonly issuer: {
    readonly legalName: string;
    readonly taxId: string;
    readonly address?: string;
  };
  readonly recipient: {
    readonly name: string;
    readonly taxId?: string;
    readonly address?: string;
    readonly email?: string;
  };
  readonly lines: ReadonlyArray<{
    readonly description: string;
    readonly quantity: string;
    readonly unitPrice: string;
    readonly total: string;
  }>;
}

export interface BillingDocumentResult {
  readonly provider: string;
  readonly providerDocumentId: string;
  readonly documentType: string;
  readonly documentNumber?: string;
  readonly issuedAt: string;
  readonly documentUrl?: string;
  readonly raw?: Readonly<Record<string, unknown>>;
}

export interface BillingProvider {
  getName(): string;
  isConfigured(): boolean;
  issueDocument(request: BillingDocumentRequest): Promise<BillingDocumentResult>;
  getDocument(providerDocumentId: string): Promise<BillingDocumentResult | null>;
  cancelDocument(providerDocumentId: string, reason: string): Promise<boolean>;
}

export class BillingProviderNotConfiguredError extends Error {
  public constructor() {
    super('Billing provider is not configured (LEGAL_REVIEW_REQUIRED before enabling)');
    this.name = 'BillingProviderNotConfiguredError';
  }
}
