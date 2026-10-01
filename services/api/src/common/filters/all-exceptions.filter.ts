import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ERROR_CODES, type ErrorCode } from '@deliveryuy/types';
import { ApiException } from '../errors/api-exception.js';
import { REQUEST_ID_HEADER } from '../middleware/request-id.middleware.js';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
}

/** Mirrors `HttpStatus.INTERNAL_SERVER_ERROR` as a plain number for comparisons. */
const SERVER_ERROR_THRESHOLD: number = HttpStatus.INTERNAL_SERVER_ERROR;

/**
 * Default public error code per HTTP status (docs/API_RULES.md).
 *
 * A lookup table is used instead of a `switch` because `HttpStatus` is a numeric
 * enum: comparing it against a plain `number` is an unsafe enum comparison.
 */
const ERROR_CODE_BY_STATUS = new Map<number, ErrorCode>([
  [HttpStatus.BAD_REQUEST, ERROR_CODES.VALIDATION_FAILED],
  [HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED],
  [HttpStatus.FORBIDDEN, ERROR_CODES.FORBIDDEN],
  [HttpStatus.NOT_FOUND, ERROR_CODES.NOT_FOUND],
  [HttpStatus.CONFLICT, ERROR_CODES.CONFLICT],
  [HttpStatus.PAYMENT_REQUIRED, ERROR_CODES.PAYMENT_FAILED],
  [HttpStatus.PAYLOAD_TOO_LARGE, ERROR_CODES.UPLOAD_TOO_LARGE],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, ERROR_CODES.UPLOAD_INVALID_TYPE],
  [HttpStatus.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED],
  [HttpStatus.SERVICE_UNAVAILABLE, ERROR_CODES.SERVICE_UNAVAILABLE],
]);

/**
 * Renders every unhandled error as the documented envelope.
 *
 * Rules:
 * - never leak stack traces, SQL text or provider payloads;
 * - unknown errors become `INTERNAL_ERROR` with a generic message while the
 *   detail is logged with the correlation id (ADR-014).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const correlationId = request.headers[REQUEST_ID_HEADER];
    const { status, body } = this.describe(exception, correlationId);

    if (status >= SERVER_ERROR_THRESHOLD) {
      // The stack stays server-side (ADR-014); the client only gets the
      // correlation id.
      this.logger.error(
        {
          correlationId,
          path: request.url,
          method: request.method,
          errorName: exception instanceof Error ? exception.name : typeof exception,
          errorMessage: exception instanceof Error ? exception.message : String(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
        },
        'Unhandled exception',
      );
    } else {
      this.logger.warn({ correlationId, path: request.url, code: body.code }, 'Request rejected');
    }

    response.status(status).json({ error: body });
  }

  private describe(
    exception: unknown,
    correlationId: string | string[] | undefined,
  ): { status: number; body: ErrorBody } {
    const correlation = Array.isArray(correlationId) ? correlationId[0] : correlationId;

    if (exception instanceof ApiException) {
      return {
        status: exception.statusCode,
        body: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          correlationId: correlation,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return {
          status,
          body: {
            code: this.defaultCodeForStatus(status),
            message: payload,
            correlationId: correlation,
          },
        };
      }

      const message = payload as { message?: string | string[]; error?: string };
      const text = Array.isArray(message.message)
        ? message.message.join('; ')
        : (message.message ?? message.error ?? 'Request failed.');

      return {
        status,
        body: {
          code: this.defaultCodeForStatus(status),
          message: text,
          correlationId: correlation,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Unexpected error. Reference the correlation id when reporting an issue.',
        correlationId: correlation,
      },
    };
  }

  private defaultCodeForStatus(status: number): ErrorCode {
    return ERROR_CODE_BY_STATUS.get(status) ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
