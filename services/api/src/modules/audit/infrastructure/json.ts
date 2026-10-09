import type { Prisma } from '@deliveryuy/database';

/**
 * Narrows a Prisma JSON column to a metadata record.
 *
 * Prisma types the column as `JsonValue`, which is any JSON. Audit and risk
 * metadata are always written as an object by this application, but a value that
 * is a number, a string or an array - for example after a manual database edit -
 * is reported as `null` rather than smuggled into a field the contract calls a
 * record.
 */
export function asMetadata(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;

  return value;
}
