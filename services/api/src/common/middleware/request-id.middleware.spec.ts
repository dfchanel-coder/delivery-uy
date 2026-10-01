import { describe, expect, it } from 'vitest';
import { requestIdMiddleware, REQUEST_ID_HEADER } from './request-id.middleware.js';

interface FakeResponse {
  headers: Record<string, string>;
  setHeader(key: string, value: string): void;
}

function invoke(incoming?: string | string[]): {
  requestHeaders: Record<string, unknown>;
  response: FakeResponse;
} {
  const requestHeaders: Record<string, unknown> = {};
  if (incoming !== undefined) {
    requestHeaders[REQUEST_ID_HEADER] = incoming;
  }

  const response: FakeResponse = {
    headers: {},
    setHeader(key, value) {
      response.headers[key] = value;
    },
  };

  requestIdMiddleware({ headers: requestHeaders } as never, response as never, () => undefined);

  return { requestHeaders, response };
}

describe('requestIdMiddleware', () => {
  it('generates a UUID when the client sends nothing', () => {
    const { requestHeaders, response } = invoke();

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/);
    expect(requestHeaders[REQUEST_ID_HEADER]).toBe(response.headers[REQUEST_ID_HEADER]);
  });

  it('reuses a safe client correlation id', () => {
    const { response } = invoke('support-case-1234');
    expect(response.headers[REQUEST_ID_HEADER]).toBe('support-case-1234');
  });

  it('replaces an unsafe client correlation id', () => {
    const { response } = invoke('<script>alert(1)</script>');
    expect(response.headers[REQUEST_ID_HEADER]).not.toContain('<script>');
  });

  it('replaces identifiers that are too short or too long', () => {
    expect(invoke('abc').response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(invoke('a'.repeat(65)).response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the first value when the header is repeated', () => {
    const { response } = invoke(['first-id-1234', 'second-id-5678']);
    expect(response.headers[REQUEST_ID_HEADER]).toBe('first-id-1234');
  });

  it('is compatible with the http module header casing', () => {
    // Node lower-cases incoming header names; the middleware must read and
    // write the same lower-case name. Guards a future refactor.
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });
});
