import type { Request } from 'express';
import { REQUEST_ID_HEADER } from '../../common/middleware/request-id.middleware.js';
import {
  principalFromRequest,
  type RequestWithPrincipal,
} from '../../common/security/endpoint-security.js';
import type { AuditActor } from './audit.ports.js';

/**
 * Builds the audit actor from a verified request.
 *
 * The role is read from the token, not from a header or the body, so a caller
 * cannot claim a role it does not hold. A user with several roles records the
 * first; the full role list lives on the account, which is what an
 * investigation consults to know the others (AGENTS.md section 29).
 *
 * It lives in the `audit` module so every writer builds the actor the same way;
 * a second controller with its own copy is how the two drift.
 */
export function auditActorFromRequest(request: Request & RequestWithPrincipal): AuditActor {
  const principal = principalFromRequest(request);
  const userAgent = request.headers['user-agent'];
  const correlationId = request.headers[REQUEST_ID_HEADER];

  return {
    userId: principal.userId,
    role: principal.roles[0] ?? null,
    ipAddress: typeof request.ip === 'string' && request.ip.length > 0 ? request.ip : null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    // The middleware has already replaced an unsafe client value with a UUID.
    correlationId: typeof correlationId === 'string' ? correlationId : null,
  };
}
