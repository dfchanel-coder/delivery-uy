import { describe, expect, it } from 'vitest';
import { isValidRut, normalizeRut, rutCheckDigit } from './rut.js';

/**
 * The check digit is the only part of a RUT that can be verified without a DGI
 * lookup, so these cases pin the algorithm: an implementation that gets the
 * remainder-0 or remainder-1 special case wrong accepts the wrong values or
 * rejects valid ones, and either error is silent until a real merchant is
 * onboarded.
 */
describe('RUT validation', () => {
  it('normalizes separators to digits', () => {
    expect(normalizeRut('21.317.103-001-4')).toBe('213171030014');
    expect(normalizeRut(' 213171030014 ')).toBe('213171030014');
    expect(normalizeRut('')).toBe('');
  });

  it('accepts twelve-digit RUTs with a correct check digit', () => {
    expect(isValidRut('213171030014')).toBe(true);
    expect(isValidRut('21.317.103.001-4')).toBe(true);
    expect(isValidRut('211234560019')).toBe(true);
  });

  it('applies the two DGI-specific remainders', () => {
    // Remainder 0 keeps the digit at 0 instead of the naive `11 - 0 = 11`.
    expect(rutCheckDigit('21000000000')).toBe(0);
    expect(isValidRut('210000000000')).toBe(true);

    // Remainder 1 maps to 6 instead of the naive `11 - 1 = 10`.
    expect(rutCheckDigit('21000000006')).toBe(6);
    expect(isValidRut('210000000066')).toBe(true);
  });

  it('rejects a wrong check digit', () => {
    expect(isValidRut('213171030013')).toBe(false);
    expect(isValidRut('210000000001')).toBe(false);
  });

  it('rejects anything that is not twelve digits', () => {
    expect(isValidRut('21317103001')).toBe(false);
    expect(isValidRut('2131710300145')).toBe(false);
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('not-a-rut')).toBe(false);
  });

  it('returns null for a body length the weights do not cover', () => {
    expect(rutCheckDigit('123')).toBeNull();
    expect(rutCheckDigit('abcdefghijk')).toBeNull();
  });
});
