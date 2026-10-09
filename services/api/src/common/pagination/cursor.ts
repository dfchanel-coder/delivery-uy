import { Buffer } from 'node:buffer';

/**
 * Opaque cursor for keyset pagination (AGENTS.md section 55).
 *
 * A cursor is not an offset. An offset page shifts when a row is inserted while
 * a client is scrolling, so the client sees a duplicate and never sees the row
 * that was pushed across the boundary. Keyset pagination asks the database for
 * "the rows after this one", which stays correct under concurrent writes.
 *
 * The value is base64url rather than raw so that a client cannot read a
 * timestamp it was not meant to, and cannot be tempted to construct one. The
 * server treats it as opaque: it is decoded, validated and otherwise ignored.
 */
export interface Cursor {
  readonly createdAt: Date;
  readonly id: string;
}

const SEPARATOR = '|';

/** Encodes the sort key of the last row of a page. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}${SEPARATOR}${cursor.id}`, 'utf8').toString(
    'base64url',
  );
}

/**
 * Decodes a cursor, or returns `null` when it is not one this server issued.
 *
 * `Buffer.from(..., 'base64url')` never throws on malformed input - it decodes
 * whatever it can - so validity is established by re-reading the exact shape
 * that was written: a parseable ISO timestamp, the separator, a non-empty id.
 * A cursor that fails any of those is reported to the caller as invalid input
 * rather than silently ignored, because silently starting from the beginning is
 * how a client loops over the first page forever.
 */
export function decodeCursor(value: string): Cursor | null {
  const raw = Buffer.from(value, 'base64url').toString('utf8');
  const index = raw.indexOf(SEPARATOR);

  if (index <= 0) return null;

  const createdAt = new Date(raw.slice(0, index));
  const id = raw.slice(index + SEPARATOR.length);

  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;

  return { createdAt, id };
}
