import { describe, expect, it } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ApiException } from '../errors/api-exception.js';

interface Captured {
  status: number;
  body: unknown;
}

function execute(exception: unknown, correlationId?: string): Captured {
  const captured: Captured = { status: 0, body: null };

  const request = {
    url: '/api/v1/orders',
    method: 'POST',
    headers: correlationId ? { 'x-request-id': correlationId } : {},
  };

  const response = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: unknown) {
      captured.body = body;
      return this;
    },
  };

  const host = {
    switchToHttp() {
      return {
        getResponse: () => response,
        getRequest: () => request,
      };
    },
  };

  new AllExceptionsFilter().catch(exception, host as never);
  return captured;
}

describe('AllExceptionsFilter', () => {
  it('renders an ApiException with its code, message and status', () => {
    const result = execute(
      new ApiException('ORDER_INVALID_STATE', 'Order cannot transition from READY to DELIVERED.'),
    );

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      error: {
        code: 'ORDER_INVALID_STATE',
        message: 'Order cannot transition from READY to DELIVERED.',
        details: undefined,
        correlationId: undefined,
      },
    });
  });

  it('includes details and the correlation id', () => {
    const result = execute(
      new ApiException('VALIDATION_FAILED', 'Invalid payload.', { field: 'email' }),
      'req-12345678',
    );

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        details: { field: 'email' },
        correlationId: 'req-12345678',
      },
    });
  });

  it('maps Nest http exceptions onto catalogue codes', () => {
    expect(execute(new HttpException('Not found', HttpStatus.NOT_FOUND)).body).toMatchObject({
      error: { code: 'NOT_FOUND' },
    });

    expect(execute(new HttpException('Too many', HttpStatus.TOO_MANY_REQUESTS)).body).toMatchObject(
      {
        error: { code: 'RATE_LIMITED' },
      },
    );

    expect(
      execute(new HttpException({ message: 'bad request' }, HttpStatus.BAD_REQUEST)).body,
    ).toMatchObject({ error: { code: 'VALIDATION_FAILED', message: 'bad request' } });
  });

  it('joins validation messages without leaking internals', () => {
    const result = execute(
      new HttpException({ message: ['email must be an email', 'password is too short'] }, 400),
    );

    expect(result.body).toMatchObject({
      error: { message: 'email must be an email; password is too short' },
    });
  });

  it('never leaks stack traces for unknown errors', () => {
    const result = execute(
      new Error('connection to postgres://user:pw@host failed'),
      'req-87654321',
    );

    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({
      error: { code: 'INTERNAL_ERROR', correlationId: 'req-87654321' },
    });

    const serialized = JSON.stringify(result.body);
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('at ');
  });
});
