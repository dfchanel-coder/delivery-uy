import { Module, Global, Logger } from '@nestjs/common';
import { type StorageProvider } from '@deliveryuy/storage';
import { AppConfigService } from '../config/app-config.service.js';
import { LocalStorageProvider } from './local-storage.provider.js';

export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

const storageProviderFactory = {
  provide: STORAGE_PROVIDER,
  useFactory: (config: AppConfigService): StorageProvider => {
    const logger = new Logger('StorageModule');
    const { provider, localPath } = config.providers.storage;

    if (provider === 'local') {
      logger.log(`Using LocalStorageProvider with path ${localPath}`);
      return new LocalStorageProvider(localPath ?? './var/storage', config.service.url);
    }

    throw new Error(`Unsupported storage provider: ${provider}`);
  },
  inject: [AppConfigService],
};

@Global()
@Module({
  providers: [storageProviderFactory],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
