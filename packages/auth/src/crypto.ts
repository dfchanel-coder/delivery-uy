import {
  createHash,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Promise wrapper around `crypto.scrypt`.
 *
 * `promisify(scrypt)` collapses to the three-argument overload and loses the
 * options signature, so the callback form is wrapped explicitly instead.
 */
function deriveScryptKey(
  secret: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, keyLength, options, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

export const TOKEN_PREFIX_REFRESH = 'rt';
export const TOKEN_PREFIX_VERIFICATION = 'vt';
export const TOKEN_PREFIX_PASSWORD_RESET = 'pr';

/**
 * Generates a cryptographically secure opaque token.
 *
 * Format: `${prefix}_${base64url(randomBytes(32))}`. The raw value is returned
 * to the client exactly once; only its SHA-256 hash is persisted
 * (ADR-002, SECURITY.md).
 */
export function generateOpaqueToken(prefix: string): { raw: string; hash: string } {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError('token prefix is required');
  }

  const base64url = randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

  const raw = `${prefix}_${base64url}`;

  return { raw, hash: sha256Hex(raw) };
}

/** SHA-256 hex digest (64 characters) used for token storage. */
export function sha256Hex(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError('input to sha256Hex must be a non-empty string');
  }

  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Timing-safe string comparison.
 *
 * Length mismatches return `false` immediately; that is intentional because
 * token digests are always fixed length, so no secret prefix is leaked.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/** Salt used for `scrypt` hashing of short secrets (delivery codes). */
export function generateSalt(bytes = 32): Buffer {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new RangeError('salt size must be between 16 and 64 bytes');
  }
  return randomBytes(bytes);
}

/**
 * Hashes a short secret such as the delivery verification code (ADR-010).
 *
 * `scrypt` is used with a per-record random salt; the salt is stored next to
 * the digest. Plaintext codes are never logged or persisted.
 */
export async function hashVerificationCode(
  code: string,
  salt: Buffer,
  options: { maxmem?: number } = {},
): Promise<string> {
  if (typeof code !== 'string' || code.length < 4 || code.length > 12) {
    throw new TypeError('verification code must be between 4 and 12 characters');
  }

  const maxmem = options.maxmem ?? 64 * 1024 * 1024;
  const derived = await deriveScryptKey(code, salt, 64, { maxmem });
  return derived.toString('hex');
}

/** Cryptographically secure integer in `[min, max]` inclusive. */
export function secureRandomInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new TypeError('min and max must be integers');
  }
  if (max < min) throw new RangeError('max must be greater than or equal to min');

  return randomInt(min, max + 1);
}

/**
 * Generates a delivery verification code (ADR-010).
 *
 * `numericOnly` defaults to true and produces 4-6 digits; alphanumeric codes
 * use an unambiguous alphabet (no `0/O`, `1/I/L`).
 */
export function generateDeliveryCode(length: number, numericOnly = true): string {
  if (!Number.isInteger(length) || length < 4 || length > 6) {
    throw new RangeError('delivery code length must be between 4 and 6');
  }

  const alphabet = numericOnly ? '0123456789' : '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let code = '';

  for (let index = 0; index < length; index += 1) {
    code += alphabet[secureRandomInt(0, alphabet.length - 1)];
  }

  return code;
}
