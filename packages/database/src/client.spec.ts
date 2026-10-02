import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRANSACTION_MAX_WAIT_MS,
  createDatabaseClient,
  withConnectionLimit,
} from './client.js';

const URL_WITH_SCHEMA = 'postgresql://user:pass@localhost:5432/deliveryuy?schema=public';

describe('withConnectionLimit', () => {
  it('pins the pool ceiling on a plain URL', () => {
    expect(withConnectionLimit('postgresql://u:p@localhost:5432/db', 10)).toBe(
      'postgresql://u:p@localhost:5432/db?connection_limit=10',
    );
  });

  it('keeps parameters the URL already carries', () => {
    // Dropping `schema=public` here would silently point the client at a
    // different schema than the migrations created.
    expect(withConnectionLimit(URL_WITH_SCHEMA, 4)).toBe(
      'postgresql://user:pass@localhost:5432/deliveryuy?schema=public&connection_limit=4',
    );
  });

  it('leaves credentials exactly as they were written', () => {
    // Re-serialising through `URL` would re-encode a password that is already
    // valid, so the string is edited instead.
    const url = 'postgresql://user:p%40ssw0rd@localhost:5432/db';
    expect(withConnectionLimit(url, 2)).toBe(`${url}?connection_limit=2`);
  });

  it('refuses a size that could not describe a pool', () => {
    expect(() => withConnectionLimit('postgresql://u:p@localhost:5432/db', 0)).toThrow(RangeError);
    expect(() => withConnectionLimit('postgresql://u:p@localhost:5432/db', -1)).toThrow(RangeError);
    expect(() => withConnectionLimit('postgresql://u:p@localhost:5432/db', 1.5)).toThrow(
      RangeError,
    );
    expect(() => withConnectionLimit('postgresql://u:p@localhost:5432/db', Number.NaN)).toThrow(
      RangeError,
    );
  });

  it('refuses to resolve two sources of truth for the same setting', () => {
    // Silently preferring one of them is how `DATABASE_POOL_SIZE` came to be
    // documented and ignored in the first place.
    expect(() =>
      withConnectionLimit('postgresql://u:p@localhost:5432/db?connection_limit=25', 10),
    ).toThrow(/already set/);
    expect(() =>
      withConnectionLimit(
        'postgresql://u:p@localhost:5432/db?schema=public&connection_limit=25',
        10,
      ),
    ).toThrow(/already set/);
  });
});

describe('createDatabaseClient', () => {
  it('exposes a transaction ceiling above the engine serialization delay', () => {
    // Prisma's default is 2000ms and two concurrent interactive transactions
    // cost about that much, so the default reliably fails concurrent refreshes.
    expect(DEFAULT_TRANSACTION_MAX_WAIT_MS).toBeGreaterThan(2000);
  });

  it('rejects a broken pool size before any engine is started', () => {
    expect(() =>
      createDatabaseClient({ url: 'postgresql://u:p@localhost:5432/db', poolSize: 0 }),
    ).toThrow(RangeError);
  });
});
