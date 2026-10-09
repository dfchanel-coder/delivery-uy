import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';
import { PagedResult } from './paged-result.js';

describe('cursor codec', () => {
  it('round-trips the sort key of a row', () => {
    const createdAt = new Date('2026-03-04T05:06:07.890Z');

    const decoded = decodeCursor(encodeCursor({ createdAt, id: 'row-1' }));

    expect(decoded).toEqual({ createdAt, id: 'row-1' });
  });

  it('does not expose the id or the timestamp in clear text', () => {
    // A cursor is opaque so a client cannot read a value it was not meant to,
    // nor be tempted to build one by hand.
    const encoded = encodeCursor({ createdAt: new Date(0), id: 'secret-row-id' });

    expect(encoded).not.toContain('secret-row-id');
    expect(encoded).not.toContain('1970');
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['an empty string', ''],
    [
      'a value with no separator',
      Buffer.from('2026-01-01T00:00:00.000Z', 'utf8').toString('base64url'),
    ],
    [
      'a separator but no id',
      Buffer.from('2026-01-01T00:00:00.000Z|', 'utf8').toString('base64url'),
    ],
    ['a separator but no timestamp', Buffer.from('|id', 'utf8').toString('base64url')],
    ['an unparseable timestamp', Buffer.from('not-a-date|id', 'utf8').toString('base64url')],
  ])('rejects %s', (_label, value) => {
    // Rejecting matters: treating a bad cursor as "start over" makes a client
    // that meant to page forward re-read page one forever.
    expect(decodeCursor(value)).toBeNull();
  });

  it('does not throw on arbitrary input', () => {
    // `Buffer.from` decodes base64url without complaint, so the validation has
    // to be the shape check, not the decode.
    expect(() => decodeCursor('!!!! not base64 !!!!')).not.toThrow();
  });
});

describe('PagedResult', () => {
  it('reports more pages when a cursor is present', () => {
    expect(new PagedResult([1, 2], 'next').hasMore).toBe(true);
  });

  it('reports the last page when the cursor is null', () => {
    expect(new PagedResult([1, 2], null).hasMore).toBe(false);
  });
});
