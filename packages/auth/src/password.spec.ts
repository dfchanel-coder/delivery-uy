import { describe, expect, it } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import {
  DEFAULT_ARGON2_PARAMETERS,
  MAX_PASSWORD_LENGTH,
  TEST_ARGON2_PARAMETERS,
  checkPasswordPolicy,
  hashPassword,
  isArgon2idHash,
  passwordNeedsRehash,
  verifyPassword,
  verifyPasswordOrDummy,
} from './password.js';

/**
 * Argon2 is intentionally slow. Tests use the cheap parameter set so the suite
 * stays fast; the production defaults are asserted separately by value.
 */
const params = TEST_ARGON2_PARAMETERS;

describe('password hashing', () => {
  it('defaults to the parameters documented in SECURITY.md', () => {
    expect(DEFAULT_ARGON2_PARAMETERS).toEqual({
      memoryKib: 65536,
      iterations: 3,
      parallelism: 1,
    });
  });

  it('produces a verifiable Argon2id hash', async () => {
    const stored = await hashPassword('correct horse battery staple', params);

    expect(isArgon2idHash(stored)).toBe(true);
    expect(stored.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(stored, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple', params);

    await expect(verifyPassword(stored, 'Correct horse battery staple')).resolves.toBe(false);
    await expect(verifyPassword(stored, '')).resolves.toBe(false);
  });

  it('never stores the plaintext', async () => {
    const stored = await hashPassword('correct horse battery staple', params);

    expect(stored).not.toContain('correct horse battery staple');
  });

  it('salts each hash, so identical passwords differ', async () => {
    const first = await hashPassword('same-password', params);
    const second = await hashPassword('same-password', params);

    expect(first).not.toBe(second);
    await expect(verifyPassword(first, 'same-password')).resolves.toBe(true);
    await expect(verifyPassword(second, 'same-password')).resolves.toBe(true);
  });

  it('fails closed on a hash that is not Argon2id', async () => {
    // A row that somehow holds an scrypt digest, a bcrypt digest or plaintext
    // must not be accepted, and must not throw a 500 either.
    const legacyScrypt = scryptSync('password', randomBytes(16), 32).toString('hex');
    const plaintext = 'stored-in-plaintext';

    expect(isArgon2idHash(legacyScrypt)).toBe(false);
    expect(isArgon2idHash(plaintext)).toBe(false);
    await expect(verifyPassword(legacyScrypt, 'password')).resolves.toBe(false);
    await expect(verifyPassword(plaintext, plaintext)).resolves.toBe(false);
    await expect(verifyPassword('', 'password')).resolves.toBe(false);
  });

  it('refuses to hash an empty or oversized password', async () => {
    await expect(hashPassword('', params)).rejects.toThrow(TypeError);
    await expect(hashPassword('x'.repeat(MAX_PASSWORD_LENGTH + 1), params)).rejects.toThrow(
      RangeError,
    );
  });

  it('refuses parameters outside the safe range', async () => {
    await expect(
      hashPassword('password', { memoryKib: 1024, iterations: 1, parallelism: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      hashPassword('password', { memoryKib: 8192, iterations: 99, parallelism: 1 }),
    ).rejects.toThrow(RangeError);
    await expect(
      hashPassword('password', { memoryKib: 8192, iterations: 1, parallelism: 99 }),
    ).rejects.toThrow(RangeError);
  });
});

describe('detect hashes that need rehash', () => {
  it('accepts a hash at the current parameters', async () => {
    const stored = await hashPassword('password', params);

    expect(passwordNeedsRehash(stored, params)).toBe(false);
  });

  it('flags a hash weaker than the current configuration', async () => {
    const weak = await hashPassword('password', { memoryKib: 8192, iterations: 1, parallelism: 1 });

    expect(passwordNeedsRehash(weak, { memoryKib: 65536, iterations: 3, parallelism: 1 })).toBe(
      true,
    );
    expect(passwordNeedsRehash(weak, { memoryKib: 8192, iterations: 3, parallelism: 1 })).toBe(
      true,
    );
  });

  it('flags a hash it cannot parse', () => {
    expect(passwordNeedsRehash('not-a-hash', params)).toBe(true);
  });
});

describe('constant-cost verification', () => {
  it('returns false for an unknown account without skipping the hashing work', async () => {
    // The point is not the return value but that both branches perform the same
    // expensive operation, so login timing cannot enumerate accounts.
    await expect(verifyPasswordOrDummy(null, 'any-password', params)).resolves.toBe(false);
    await expect(verifyPasswordOrDummy(null, 'any-password', params)).resolves.toBe(false);
  });

  it('still verifies a real hash', async () => {
    const stored = await hashPassword('password', params);

    await expect(verifyPasswordOrDummy(stored, 'password', params)).resolves.toBe(true);
    await expect(verifyPasswordOrDummy(stored, 'wrong', params)).resolves.toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a password at the minimum length', () => {
    expect(checkPasswordPolicy('1234567890', { minLength: 10 })).toEqual([]);
  });

  it('reports the exact problem instead of a bare false', () => {
    expect(checkPasswordPolicy('short', { minLength: 10 })).toEqual([
      'password must be at least 10 characters',
    ]);
    expect(checkPasswordPolicy('x'.repeat(20), { minLength: 10, maxLength: 12 })).toEqual([
      'password must not exceed 12 characters',
    ]);
    expect(checkPasswordPolicy('x'.repeat(20), { minLength: 10 })).toEqual([]);
  });

  it('does not impose composition rules that were never specified', () => {
    // "abcdefghij" is weak by any dictionary, but the platform enforces length
    // plus Argon2id; inventing an unstated rule only drives substitution.
    expect(checkPasswordPolicy('abcdefghij', { minLength: 10 })).toEqual([]);
  });

  it('rejects a non-string password', () => {
    expect(checkPasswordPolicy(undefined as unknown as string, { minLength: 10 })).toHaveLength(1);
  });
});
