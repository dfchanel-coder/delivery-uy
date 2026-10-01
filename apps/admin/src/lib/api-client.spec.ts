import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiClientError, createApiClient } from './api-client';
import { loadAdminEnv } from './config';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const idSchema = z.object({ id: z.string() });

describe('loadAdminEnv', () => {
  it('applies documented defaults when nothing is set', () => {
    expect(loadAdminEnv({})).toEqual({
      API_URL: 'http://localhost:3000',
      API_TIMEOUT_MS: 5_000,
      ADMIN_PANEL_NAME: 'DeliveryUY Admin',
    });
  });

  it('rejects a relative API_URL instead of guessing', () => {
    expect(() => loadAdminEnv({ API_URL: '/api' })).toThrow(/API_URL/);
  });

  it('rejects an absurd timeout', () => {
    expect(() => loadAdminEnv({ API_TIMEOUT_MS: '10' })).toThrow(/API_TIMEOUT_MS/);
  });

  it('coerces a numeric string', () => {
    expect(loadAdminEnv({ API_TIMEOUT_MS: '2500' }).API_TIMEOUT_MS).toBe(2_500);
  });
});

describe('createApiClient', () => {
  it('unwraps the success envelope', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ data: { id: 'abc' } });
    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    await expect(client.getData('/api/v1/thing', idSchema)).resolves.toEqual({ id: 'abc' });
  });

  it('joins the base URL and the path without doubling slashes', async () => {
    let requested = '';
    const fetchImpl: typeof fetch = async (input) => {
      requested = input instanceof Request ? input.url : input.toString();
      return jsonResponse({ data: { id: 'abc' } });
    };

    const client = createApiClient({ baseUrl: 'http://api.test/', timeoutMs: 1_000, fetchImpl });
    await client.getData('api/v1/thing', idSchema);

    expect(requested).toBe('http://api.test/api/v1/thing');
  });

  it('maps an API error envelope to a typed error with the correlation id', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(
        {
          error: {
            code: 'ORDER_INVALID_STATE',
            message: 'Order cannot transition from READY to DELIVERED.',
            correlationId: 'c1c1c1c1-0000-4000-8000-000000000001',
          },
        },
        409,
      );

    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    const error = await client
      .getData('/api/v1/orders/1', idSchema)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      kind: 'http',
      code: 'ORDER_INVALID_STATE',
      status: 409,
      correlationId: 'c1c1c1c1-0000-4000-8000-000000000001',
    });
  });

  it('falls back to INTERNAL_ERROR when the failure body is not the documented envelope', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('<html>bad gateway</html>', { status: 502 });
    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    await expect(client.getData('/api/v1/thing', idSchema)).rejects.toMatchObject({
      kind: 'http',
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('reports an unreachable API as a transport failure, not a crash', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };

    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    await expect(client.getData('/api/v1/thing', idSchema)).rejects.toMatchObject({
      kind: 'transport',
      code: 'SERVICE_UNAVAILABLE',
      status: 0,
    });
  });

  it('detects a timeout through AbortSignal', async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
        });
      });

    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 5, fetchImpl });

    await expect(client.getData('/api/v1/thing', idSchema)).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('rejects a 2xx payload that does not match the schema', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ data: { status: 'weird' } });
    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    await expect(
      client.getData('/api/v1/health/live', z.object({ status: z.literal('ok') })),
    ).rejects.toMatchObject({ kind: 'contract', code: 'INVALID_RESPONSE_CONTRACT' });
  });

  it('sends an idempotency key when the caller supplies one', async () => {
    let seen: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return jsonResponse({ data: { id: 'order-1' } });
    };

    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });

    await client.getData('/api/v1/orders/pending', idSchema, {
      idempotencyKey: 'key-1',
    });

    expect(seen?.get('idempotency-key')).toBe('key-1');
    expect(seen?.get('content-type')).toBeNull();
  });

  it('unwraps paginated lists', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ data: ['a', 'b'], pagination: { nextCursor: 'c2', hasMore: true } });

    const client = createApiClient({ baseUrl: 'http://api.test', timeoutMs: 1_000, fetchImpl });
    const page = await client.getPage('/api/v1/orders', z.string());

    expect(page.items).toEqual(['a', 'b']);
    expect(page.pagination).toEqual({ nextCursor: 'c2', hasMore: true });
  });
});
