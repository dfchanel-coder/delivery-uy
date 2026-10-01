/**
 * StorageProvider - ARCHITECTURE.md section 11.
 *
 * Used for merchant documents, driver documents, profile photos, product
 * images and support attachments. Objects are always addressed by an opaque
 * server-generated key; public URLs are never derived from user input
 * (AGENTS.md sections 24 and 71).
 */

export const STORAGE_VISIBILITIES = ['PRIVATE', 'PUBLIC'] as const;
export type StorageVisibility = (typeof STORAGE_VISIBILITIES)[number];

export interface StoredObject {
  readonly key: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly visibility: StorageVisibility;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: string;
}

export interface PutObjectRequest {
  /** Server-generated key, e.g. `drivers/<uuid>/license/<uuid>.pdf`. */
  readonly key: string;
  readonly body: Buffer;
  readonly contentType: string;
  readonly visibility: StorageVisibility;
}

export interface StorageProvider {
  getName(): string;
  putObject(request: PutObjectRequest): Promise<StoredObject>;
  getObject(key: string): Promise<Buffer>;
  /**
   * Returns a short-lived URL. Private objects are never served directly; the
   * caller authorises access before requesting the URL.
   */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<SignedUrl>;
  deleteObject(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
}

export class StorageProviderNotConfiguredError extends Error {
  public constructor() {
    super('Storage provider is not configured');
    this.name = 'StorageProviderNotConfiguredError';
  }
}

/** Content types accepted for identity documents and merchant documentation. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export function isAllowedDocumentContentType(contentType: string): boolean {
  return ALLOWED_DOCUMENT_CONTENT_TYPES.includes(contentType.toLowerCase());
}
