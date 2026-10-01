import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { API_PREFIX, createApp } from '../../bootstrap.js';

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers the liveness probe without touching infrastructure', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/live`);

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toMatchObject({ status: 'ok' });
    expect(typeof response.body.data.service).toBe('string');
  });

  it('wraps successful responses in the documented envelope', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/live`);

    expect(Object.keys(response.body)).toEqual(['data']);
  });

  it('returns a correlation id on every response', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/live`);

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('echoes a safe client supplied correlation id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health/live`)
      .set('X-Request-Id', 'support-case-1234');

    expect(response.headers['x-request-id']).toBe('support-case-1234');
  });

  it('rejects an unsafe client supplied correlation id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health/live`)
      .set('X-Request-Id', '<script>alert(1)</script>');

    expect(response.headers['x-request-id']).not.toContain('<script>');
  });

  it('applies helmet headers', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/health/live`);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('answers unknown routes with the structured error envelope and no stack trace', async () => {
    const response = await request(app.getHttpServer()).get(`/${API_PREFIX}/does-not-exist`);

    expect(response.statusCode).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toBeTypeOf('string');
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });

  it('serves the OpenAPI document with versioned paths', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    expect(response.statusCode).toBe(200);
    expect(response.body.paths).toHaveProperty(`/${API_PREFIX}/health/live`);
    expect(response.body.paths).toHaveProperty(`/${API_PREFIX}/health/ready`);
    // No hardcoded host: the document resolves against its own origin.
    expect(response.body.servers ?? []).toEqual([]);
  });
});
