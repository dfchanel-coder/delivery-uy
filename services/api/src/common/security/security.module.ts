import { createAccessTokenIssuer, type AccessTokenIssuer } from '@deliveryuy/auth';
import { Global, Injectable, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * Access token issuing for the HTTP layer.
 *
 * The secret is read once at startup from validated configuration and never
 * logged (SECURITY.md "Secrets"). The issuer itself lives in
 * `@deliveryuy/auth` and performs no I/O, which keeps the cryptography testable
 * without NestJS.
 */
@Injectable()
export class AccessTokenService implements AccessTokenIssuer {
  private readonly issuer: AccessTokenIssuer;

  public constructor(config: AppConfigService) {
    const { accessSecret, accessExpiresIn, issuer, audience } = config.auth;

    this.issuer = createAccessTokenIssuer({
      secret: accessSecret,
      expiresIn: accessExpiresIn,
      issuer,
      audience,
    });
  }

  public issue(input: {
    subject: string;
    sessionId: string;
    roles: readonly string[];
  }): Promise<{ token: string; issuedAt: Date; expiresAt: Date }> {
    return this.issuer.issue(input);
  }

  public verify(token: string): ReturnType<AccessTokenIssuer['verify']> {
    return this.issuer.verify(token);
  }
}

/**
 * Global because guards and decorators resolve the token issuer from the
 * injector, whichever module the controller belongs to.
 */
@Global()
@Module({
  providers: [AccessTokenService],
  exports: [AccessTokenService],
})
export class SecurityModule {}
