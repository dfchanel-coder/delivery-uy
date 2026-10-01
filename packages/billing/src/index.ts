import { BillingProviderNotConfiguredError, type BillingProvider } from './billing-provider.js';

export * from './billing-provider.js';

export const BILLING_PROVIDER_NAMES = ['none', 'cfe', 'external'] as const;
export type BillingProviderName = (typeof BILLING_PROVIDER_NAMES)[number];

function reject(): Promise<never> {
  return Promise.reject(new BillingProviderNotConfiguredError());
}

/**
 * Guard used until a fiscal provider is validated.
 *
 * Issuing a fabricated fiscal document would be a legal and accounting
 * violation, so every operation fails loudly.
 */
class UnconfiguredBillingProvider implements BillingProvider {
  getName(): string {
    return 'none';
  }

  isConfigured(): boolean {
    return false;
  }

  issueDocument(): Promise<never> {
    return reject();
  }

  getDocument(): Promise<null> {
    return Promise.resolve(null);
  }

  cancelDocument(): Promise<false> {
    return Promise.resolve(false);
  }
}

const registry = new Map<BillingProviderName, () => BillingProvider>([
  ['none', () => new UnconfiguredBillingProvider()],
]);

export function registerBillingProvider(
  name: BillingProviderName,
  factory: () => BillingProvider,
): void {
  registry.set(name, factory);
}

export function resolveBillingProvider(name: BillingProviderName): BillingProvider {
  const factory = registry.get(name);

  if (!factory) {
    throw new BillingProviderNotConfiguredError();
  }

  return factory();
}
