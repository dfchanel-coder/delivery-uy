import { PaymentProviderNotConfiguredError, type PaymentProvider } from './payment-provider.js';

export * from './payment-provider.js';

export const PAYMENT_PROVIDER_NAMES = ['none', 'mercadopago', 'cash'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

function reject(): Promise<never> {
  return Promise.reject(new PaymentProviderNotConfiguredError());
}

/**
 * Guard used while no provider is configured.
 *
 * It never fabricates a payment approval (AGENTS.md sections 5 and 18): an
 * unconfigured provider fails loudly instead of reporting a fake success.
 */
class UnconfiguredPaymentProvider implements PaymentProvider {
  getName(): string {
    return 'none';
  }

  createPayment(): Promise<never> {
    return reject();
  }

  getPayment(): Promise<never> {
    return reject();
  }

  refund(): Promise<never> {
    return reject();
  }

  parseWebhookEvent(rawBody: Buffer, headers: Readonly<Record<string, string>>): never {
    void rawBody;
    void headers;
    throw new PaymentProviderNotConfiguredError();
  }
}

const registry = new Map<PaymentProviderName, () => PaymentProvider>([
  ['none', () => new UnconfiguredPaymentProvider()],
]);

export function registerPaymentProvider(
  name: PaymentProviderName,
  factory: () => PaymentProvider,
): void {
  registry.set(name, factory);
}

export function resolvePaymentProvider(name: PaymentProviderName): PaymentProvider {
  const factory = registry.get(name);

  if (!factory) {
    throw new PaymentProviderNotConfiguredError(name);
  }

  return factory();
}
