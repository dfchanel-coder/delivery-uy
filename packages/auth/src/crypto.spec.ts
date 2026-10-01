import { describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  generateDeliveryCode,
  generateOpaqueToken,
  generateSalt,
  hashVerificationCode,
  sha256Hex,
} from './crypto.js';

describe('generateOpaqueToken', () => {
  it('returns a prefixed raw token and its sha256 hash', () => {
    const token = generateOpaqueToken('rt');

    expect(token.raw.startsWith('rt_')).toBe(true);
    expect(token.raw.length).toBeGreaterThan(30);
    expect(token.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(token.hash).toBe(sha256Hex(token.raw));
  });

  it('produces unique tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateOpaqueToken('vt').hash));
    expect(tokens.size).toBe(200);
  });

  it('never exposes the token in the hash', () => {
    const token = generateOpaqueToken('pr');
    expect(token.hash).not.toContain(token.raw);
  });
});

describe('constantTimeEqual', () => {
  it('compares equal and unequal digests correctly', () => {
    const digest = sha256Hex('value');
    expect(constantTimeEqual(digest, digest)).toBe(true);
    expect(constantTimeEqual(digest, sha256Hex('other'))).toBe(false);
    expect(constantTimeEqual(digest, `${digest}x`)).toBe(false);
    expect(constantTimeEqual(digest, '')).toBe(false);
  });
});

describe('generateDeliveryCode', () => {
  it('produces a numeric code of the requested length', () => {
    const code = generateDeliveryCode(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('enforces the 4-6 range from ADR-010', () => {
    expect(() => generateDeliveryCode(3)).toThrow(RangeError);
    expect(() => generateDeliveryCode(7)).toThrow(RangeError);
  });

  it('can produce unambiguous alphanumeric codes when numeric only is disabled', () => {
    const code = generateDeliveryCode(6, false);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(code).not.toMatch(/[01ILO]/);
  });

  it('does not repeat itself across many samples', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateDeliveryCode(6)));
    expect(codes.size).toBeGreaterThan(490);
  });
});

describe('hashVerificationCode', () => {
  it('produces the same digest for the same code and salt', async () => {
    const salt = generateSalt();
    const first = await hashVerificationCode('482913', salt);
    const second = await hashVerificationCode('482913', salt);
    expect(first).toBe(second);
  });

  it('produces different digests for different salts', async () => {
    const a = await hashVerificationCode('482913', generateSalt());
    const b = await hashVerificationCode('482913', generateSalt());
    expect(a).not.toBe(b);
  });

  it('does not verify a wrong code against the digest', async () => {
    const digest = await hashVerificationCode('482913', generateSalt());
    const wrong = await hashVerificationCode('482914', generateSalt());
    expect(constantTimeEqual(digest, wrong)).toBe(false);
  });

  it('rejects implausible inputs', async () => {
    const salt = generateSalt();
    await expect(hashVerificationCode('12', salt)).rejects.toThrow(TypeError);
  });
});
