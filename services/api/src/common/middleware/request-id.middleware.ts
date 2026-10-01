import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Only accept client ids that are safe to log and store. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Attaches a correlation id to every request (ADR-014).
 *
 * The id is echoed in the response header so a user can quote it in a support
 * request, and it is propagated to logs and job payloads.
 */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const correlationId =
    typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();

  request.headers[REQUEST_ID_HEADER] = correlationId;
  response.setHeader(REQUEST_ID_HEADER, correlationId);

  next();
}
