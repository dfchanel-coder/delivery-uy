import type { InjectionToken } from '@nestjs/common';
import type { NotificationProvider } from '@deliveryuy/notifications';

/**
 * Injection token for the notification port.
 *
 * The port is an interface, which TypeScript erases, so the binding needs a
 * runtime value. The token carries the interface type so a consumer's factory
 * receives a typed argument instead of `unknown`.
 */
export const NOTIFICATION_PROVIDER: InjectionToken<NotificationProvider> =
  'DELIVERYUY_NOTIFICATION_PROVIDER';
