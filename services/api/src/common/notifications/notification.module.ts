import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { NOTIFICATION_PROVIDER } from './notification.tokens.js';
import { NotificationHealthProbe } from './notification-health.probe.js';
import { ProviderFactory } from './provider.factory.js';

/**
 * Binds the notification port to the configured provider.
 *
 * The choice is made once, from validated configuration, at startup. Business
 * code depends on `NOTIFICATION_PROVIDER` and never learns which
 * implementation it received, so adding a channel later is a change here
 * (AGENTS.md sections 60, 80).
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: NOTIFICATION_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ProviderFactory.create(config),
    },
    NotificationHealthProbe,
  ],
  exports: [NOTIFICATION_PROVIDER],
})
export class NotificationModule {}
