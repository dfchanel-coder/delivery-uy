import {
  NotificationProviderNotConfiguredError,
  type NotificationProvider,
} from './notification-provider.js';

export * from './notification-provider.js';

export const NOTIFICATION_PROVIDER_NAMES = ['none', 'fcm', 'smtp'] as const;
export type NotificationProviderName = (typeof NOTIFICATION_PROVIDER_NAMES)[number];

function reject(): Promise<never> {
  return Promise.reject(new NotificationProviderNotConfiguredError());
}

class UnconfiguredNotificationProvider implements NotificationProvider {
  getName(): string {
    return 'none';
  }

  supports(): boolean {
    return false;
  }

  send(): Promise<never> {
    return reject();
  }
}

const registry = new Map<NotificationProviderName, () => NotificationProvider>([
  ['none', () => new UnconfiguredNotificationProvider()],
]);

export function registerNotificationProvider(
  name: NotificationProviderName,
  factory: () => NotificationProvider,
): void {
  registry.set(name, factory);
}

export function resolveNotificationProvider(name: NotificationProviderName): NotificationProvider {
  const factory = registry.get(name);

  if (!factory) {
    throw new NotificationProviderNotConfiguredError();
  }

  return factory();
}
