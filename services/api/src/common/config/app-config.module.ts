import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfigService, parseEnvironment } from './app-config.service.js';

export { APP_CONFIG, AppConfigService };

/**
 * Provides the validated bootstrap configuration application-wide.
 *
 * Parsing happens once, during module initialisation, so an invalid environment
 * fails fast at boot instead of at the first request that needs a value.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: parseEnvironment,
    },
    AppConfigService,
  ],
  exports: [AppConfigService, APP_CONFIG],
})
export class AppConfigModule {}
