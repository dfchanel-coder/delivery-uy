/**
 * Uruguayan RUT (Registro Único Tributario) validation.
 *
 * The RUT is a 12-digit identifier issued by the DGI. The twelfth digit is a
 * mod-11 check digit over the first eleven, with the fixed weight vector
 * below; a remainder of 0 maps to `0` and a remainder of 1 maps to `6`, which
 * are the two DGI-specific cases (the plain `11 - remainder` rule would yield
 * `11` and `10`).
 *
 * This validates the structure a value must have to be a RUT. It does not
 * prove the number exists, is active, or belongs to the person submitting it:
 * that requires a DGI lookup this platform does not perform. Whether a merchant
 * must hold a RUT at all, and in which legal form, is a fiscal question and is
 * marked `LEGAL_REVIEW_REQUIRED` in LEGAL.md (AGENTS.md section 68).
 */

/** Weights, left to right, for the first eleven digits. */
const RUT_WEIGHTS = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

const RUT_DIGITS = 12;

/** Strips the cosmetic separators, keeping only digits. */
export function normalizeRut(rut: string): string {
  return rut.replace(/\D/g, '');
}

/**
 * Computes the check digit for the first eleven digits of a normalized RUT.
 *
 * Exported so a test can assert the two DGI-specific remainders directly,
 * rather than relying only on whole-value examples.
 */
export function rutCheckDigit(elevenDigits: string): number | null {
  if (elevenDigits.length !== RUT_DIGITS - 1 || !/^\d+$/.test(elevenDigits)) return null;

  let sum = 0;
  for (let index = 0; index < RUT_WEIGHTS.length; index += 1) {
    sum += Number(elevenDigits[index]) * RUT_WEIGHTS[index]!;
  }

  const remainder = sum % 11;

  if (remainder === 0) return 0;
  if (remainder === 1) return 6;

  return 11 - remainder;
}

/** True only when `rut` normalizes to twelve digits with a correct check digit. */
export function isValidRut(rut: string): boolean {
  const digits = normalizeRut(rut);
  if (digits.length !== RUT_DIGITS) return false;

  const expected = rutCheckDigit(digits.slice(0, RUT_DIGITS - 1));
  if (expected === null) return false;

  return expected === Number(digits[RUT_DIGITS - 1]);
}
