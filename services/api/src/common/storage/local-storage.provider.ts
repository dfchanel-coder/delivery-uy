import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  type StorageProvider,
  type PutObjectRequest,
  type StoredObject,
  type SignedUrl,
} from '@deliveryuy/storage';

type NodeError = NodeJS.ErrnoException & { code?: string };

export class LocalStorageProvider implements StorageProvider {
  public constructor(
    private readonly basePath: string,
    private readonly baseUrl: string,
  ) {}

  public getName(): string {
    return 'local';
  }

  private assertSafeKey(key: string): void {
    if (key === undefined || key === null || typeof key !== 'string') {
      throw new Error('Invalid storage key');
    }
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      throw new Error('Storage key cannot be empty');
    }
    if (path.isAbsolute(trimmed)) {
      throw new Error('Storage key cannot be absolute');
    }
    const segments = trimmed.split(/[\\/]/).filter((segment) => segment.length > 0);
    for (const segment of segments) {
      if (segment === '.' || segment === '..') {
        throw new Error('Invalid storage key path');
      }
    }
  }

  private resolveKey(key: string): string {
    this.assertSafeKey(key);
    return key;
  }

  public async putObject(request: PutObjectRequest): Promise<StoredObject> {
    const key = this.resolveKey(request.key);
    const fullPath = path.join(this.basePath, key);
    const dirname = path.dirname(fullPath);

    await fs.mkdir(dirname, { recursive: true });
    await fs.writeFile(fullPath, request.body);

    return {
      key,
      sizeBytes: request.body.length,
      contentType: request.contentType,
      visibility: request.visibility,
    };
  }

  public async getObject(key: string): Promise<Buffer> {
    const safeKey = this.resolveKey(key);
    const fullPath = path.join(this.basePath, safeKey);
    return fs.readFile(fullPath);
  }

  public getSignedUrl(key: string, expiresInSeconds: number): Promise<SignedUrl> {
    const safeKey = this.resolveKey(key);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    return Promise.resolve({
      url: `${this.baseUrl.replace(/\/$/, '')}/storage/${safeKey}`,
      expiresAt,
    });
  }

  public async deleteObject(key: string): Promise<boolean> {
    const safeKey = this.resolveKey(key);
    const fullPath = path.join(this.basePath, safeKey);
    try {
      await fs.unlink(fullPath);
      return true;
    } catch (e: unknown) {
      const err = e as NodeError;
      if (err.code === 'ENOENT') {
        return false;
      }
      throw e;
    }
  }

  public async exists(key: string): Promise<boolean> {
    const safeKey = this.resolveKey(key);
    const fullPath = path.join(this.basePath, safeKey);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }
}
