import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap.js';
import { AppConfigService } from './common/config/app-config.service.js';
import { ConfigurationError } from '@deliveryuy/config';

async function main(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await createApp();
  const config = app.get(AppConfigService).get();

  await app.listen(config.service.port, '0.0.0.0');

  logger.log(`DeliveryUY API listening on port ${config.service.port} (${config.env})`);
  logger.log(
    `Swagger available at /${config.service.url.replace(/^https?:\/\/[^/]+/, '')}api/docs`,
  );
}

main().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  if (error instanceof ConfigurationError) {
    logger.error(`Configuration is invalid:\n${error.message}`);
    process.exitCode = 78; // EX_CONFIG
    return;
  }

  logger.error('Fatal error during bootstrap', error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
