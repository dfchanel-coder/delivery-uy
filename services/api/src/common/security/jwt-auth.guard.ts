import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AccessTokenError,
  principalFromClaims,
  type AuthenticatedPrincipal,
} from '@deliveryuy/auth';
import { ERROR_CODES } from '@deliveryuy/types';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';
import { IS_PUBLIC_KEY, type RequestWithPrincipal } from './endpoint-security.js';
import { AccessTokenService } from './security.module.js';

export const BEARER_SCHEME = 'bearer';

/**
 * Authenticates every request unless the route is explicitly public.
 *
 * Registered globally, so authentication is the default rather than something
 * each controller has to remember (docs/API_RULES.md "Endpoint Security").
 *
 * A verified token yields a principal and nothing else: controllers never see
 * the raw token, and they cannot read a user id from the request body.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  public constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();
    const token = this.readBearerToken(request);

    if (token === null) {
      throw new ApiException(
        ERROR_CODES.UNAUTHENTICATED,
        'Authentication is required.',
        undefined,
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      const claims = await this.accessTokens.verify(token);
      const principal: AuthenticatedPrincipal = principalFromClaims(claims);
      request.principal = principal;

      return true;
    } catch (error: unknown) {
      throw this.translate(error);
    }
  }

  private readBearerToken(request: Request): string | null {
    const header = request.headers.authorization;

    if (typeof header !== 'string') return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== BEARER_SCHEME) return null;

    const token = value?.trim();
    return token !== undefined && token.length > 0 ? token : null;
  }

  /**
   * Translates a library rejection into the documented error code.
   *
   * `TOKEN_EXPIRED` is distinct from `TOKEN_INVALID` on purpose: it tells the
   * client to refresh instead of discarding the session, and it is the only
   * rejection that is expected during normal operation.
   */
  private translate(error: unknown): ApiException {
    if (!(error instanceof AccessTokenError)) {
      this.logger.error(`Unexpected access token failure: ${String(error)}`);
      return new ApiException(
        ERROR_CODES.INTERNAL_ERROR,
        'Unexpected error. Reference the correlation id when reporting an issue.',
      );
    }

    this.logger.debug(`Access token rejected (${error.rejection})`);

    const code =
      error.rejection === 'expired' ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID;

    return new ApiException(
      code,
      error.rejection === 'expired' ? 'Access token has expired.' : 'Access token is invalid.',
      { reason: error.rejection },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
