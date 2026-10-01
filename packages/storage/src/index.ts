import {
  isAllowedDocumentContentType,
  StorageProviderNotConfiguredError,
  type StorageProvider,
} from './storage-provider.js';

export * from './storage-provider.js';

export const STORAGE_PROVIDER_NAMES = ['local', 's3'] as const;
export type StorageProviderName = (typeof STORAGE_PROVIDER_NAMES)[number];

function reject(): Promise<never> {
  return Promise.reject(new StorageProviderNotConfiguredError());
}

class UnconfiguredStorageProvider implements StorageProvider {
  getName(): string {
    return 'none';
  }

  putObject(): Promise<never> {
    return reject();
  }

  getObject(): Promise<never> {
    return reject();
  }

  getSignedUrl(): Promise<never> {
    return reject();
  }

  deleteObject(): Promise<false> {
    return Promise.resolve(false);
  }

  exists(): Promise<false> {
    return Promise.resolve(false);
  }
}

const registry = new Map<StorageProviderName, () => StorageProvider>([
  ['local', () => new UnconfiguredStorageProvider()],
  ['s3', () => new UnconfiguredStorageProvider()],
]);

export function registerStorageProvider(
  name: StorageProviderName,
  factory: () => StorageProvider,
): void {
  registry.set(name, factory);
}

export function resolveStorageProvider(name: StorageProviderName): StorageProvider {
  const factory = registry.get(name);

  if (!factory) {
    throw new StorageProviderNotConfiguredError();
  }

  return factory();
}

export { isAllowedDocumentContentType };
