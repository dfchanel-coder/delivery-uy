import { HttpStatus } from '@nestjs/common';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@deliveryuy/types';

/**
 * Domain/service level error carrying a machine-readable code.
 *
 * Controllers and services throw this; the global filter renders the envelope
 * defined in docs/API_RULES.md. Stack traces never reach the client
 * (AGENTS.md section 36).
 */
export class ApiException extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
    public readonly statusCode: number = ERROR_HTTP_STATUS[code],
  ) {
    super(message);
    this.name = 'ApiException';
  }

  public static notFound(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): ApiException {
    return new ApiException(code, message, details, HttpStatus.NOT_FOUND);
  }

  public static conflict(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): ApiException {
    return new ApiException(code, message, details, HttpStatus.CONFLICT);
  }

  public static forbidden(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ): ApiException {
    return new ApiException(code, message, details, HttpStatus.FORBIDDEN);
  }

  public static unauthorized(
    code: ErrorCode = 'UNAUTHENTICATED',
    message = 'Authentication is required.',
  ): ApiException {
    return new ApiException(code, message, undefined, HttpStatus.UNAUTHORIZED);
  }
}
