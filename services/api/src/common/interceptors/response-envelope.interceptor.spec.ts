import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { PagedResult } from '../pagination/paged-result.js';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor.js';

/**
 * The response envelope is the one place the wire shape is decided, so its two
 * behaviours are pinned here: a normal value is nested under `data`, and a
 * `PagedResult` is unwrapped into `data` + `pagination`.
 */

const context = {} as ExecutionContext;

function handlerFor<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

async function envelopeOf<T>(value: T): Promise<unknown> {
  return firstValueFrom(new ResponseEnvelopeInterceptor<T>().intercept(context, handlerFor(value)));
}

describe('ResponseEnvelopeInterceptor', () => {
  it('nests a plain object under data', async () => {
    await expect(envelopeOf({ ok: true })).resolves.toEqual({ data: { ok: true } });
  });

  it('nests a bare array under data', async () => {
    await expect(envelopeOf([1, 2, 3])).resolves.toEqual({ data: [1, 2, 3] });
  });

  it('lifts a page into data and pagination', async () => {
    const result = await envelopeOf(new PagedResult(['a', 'b'], 'cursor-1'));

    expect(result).toEqual({
      data: ['a', 'b'],
      pagination: { nextCursor: 'cursor-1', hasMore: true },
    });
  });

  it('reports hasMore false on the last page', async () => {
    const result = await envelopeOf(new PagedResult(['a'], null));

    expect(result).toEqual({ data: ['a'], pagination: { nextCursor: null, hasMore: false } });
  });

  it('does not mistake a look-alike object for a page', async () => {
    // The marker is a class, not a shape. An object with the same keys is a
    // domain value and must stay nested, or an endpoint would answer with a
    // pagination member it never declared.
    const lookAlike = { items: ['a'], nextCursor: 'x' };

    await expect(envelopeOf(lookAlike)).resolves.toEqual({ data: lookAlike });
  });
});
