import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type {
  AuthSessionResponse,
  AuthenticatedUser,
  EmailConfirmationResult,
  PasswordRecoveryAccepted,
  PasswordRecoveryResult,
  RegisterResponse,
} from '@deliveryuy/types';
import type { Request } from 'express';
import {
  principalFromRequest,
  Public,
  RateLimit,
  type RequestWithPrincipal,
} from '../../common/security/endpoint-security.js';
import { AuthService } from './auth.service.js';
import {
  LoginDto,
  PasswordRecoveryCompleteDto,
  PasswordRecoveryRequestDto,
  RefreshTokenDto,
  RegisterDto,
  VerifyEmailDto,
} from './dto/auth.dto.js';
import type { RequestContext } from './ports.js';

/**
 * Authentication endpoints (ADR-002).
 *
 * The controller only parses, validates and delegates. Every route states its
 * security level explicitly: public routes carry `@Public()` and, because
 * authentication is the default everywhere else, that is the only way to expose
 * an endpoint (docs/API_RULES.md "Endpoint Security").
 *
 * Rate limits are declared here rather than inside the service so that the
 * limits are visible in one place when reviewing the public surface.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  public constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create a customer account.' })
  @ApiCreatedResponse({
    description: 'Account created. `tokens` is null until the address is verified.',
  })
  @RateLimit(
    { name: 'auth:register:ip', scope: 'ip', limit: 10, windowSeconds: 900 },
    { name: 'auth:register:email', scope: 'email', limit: 3, windowSeconds: 3600 },
  )
  public async register(
    @Body() body: RegisterDto,
    @Req() request: Request,
  ): Promise<RegisterResponse> {
    return this.auth.register(body, contextOf(request));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for an access token and a refresh token.' })
  @ApiOkResponse({ description: 'Session started.' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials.' })
  @RateLimit(
    { name: 'auth:login:ip', scope: 'ip', limit: 20, windowSeconds: 300 },
    { name: 'auth:login:email', scope: 'email', limit: 10, windowSeconds: 900 },
  )
  public async login(
    @Body() body: LoginDto,
    @Req() request: Request,
  ): Promise<AuthSessionResponse> {
    return this.auth.login(body, contextOf(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and mint a new access token.',
    description:
      'The presented token is invalidated. Presenting an already rotated token revokes the whole token family.',
  })
  @ApiUnauthorizedResponse({ description: 'Unknown, expired, revoked or replayed token.' })
  @RateLimit({ name: 'auth:refresh:ip', scope: 'ip', limit: 60, windowSeconds: 900 })
  public async refresh(
    @Body() body: RefreshTokenDto,
    @Req() request: Request,
  ): Promise<AuthSessionResponse> {
    return this.auth.refresh(body.refreshToken, contextOf(request));
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Close one session. Idempotent.' })
  @RateLimit({ name: 'auth:logout:ip', scope: 'ip', limit: 60, windowSeconds: 900 })
  public async logout(@Body() body: RefreshTokenDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close every session of the caller.' })
  @RateLimit({ name: 'auth:logout-all:user', scope: 'user', limit: 20, windowSeconds: 900 })
  public async logoutEverywhere(
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.auth.logoutEverywhere(principalFromRequest(request).userId),
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Account behind the current access token.' })
  public async me(@Req() request: Request & RequestWithPrincipal): Promise<AuthenticatedUser> {
    return this.auth.currentUser(principalFromRequest(request).userId);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start password recovery.',
    description:
      'Always answers the same way, whether or not the address is registered, so it cannot enumerate accounts.',
  })
  @RateLimit(
    { name: 'auth:forgot:ip', scope: 'ip', limit: 10, windowSeconds: 3600 },
    { name: 'auth:forgot:email', scope: 'email', limit: 3, windowSeconds: 3600 },
  )
  public async forgot(
    @Body() body: PasswordRecoveryRequestDto,
    @Req() request: Request,
  ): Promise<PasswordRecoveryAccepted> {
    await this.auth.requestPasswordRecovery(body.email, request.ip ?? null);

    return { status: 'accepted' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete password recovery.',
    description: 'Consumes the token and revokes every existing session.',
  })
  @RateLimit({ name: 'auth:reset:ip', scope: 'ip', limit: 10, windowSeconds: 3600 })
  public async reset(@Body() body: PasswordRecoveryCompleteDto): Promise<PasswordRecoveryResult> {
    return this.auth.completePasswordRecovery(body.token, body.password);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an email address with the code that was delivered.',
    description:
      'Consumes the verification token. `canSignIn` is false when the deployment also requires an ' +
      'administrator approval, because a verified address is not the same thing as a usable account.',
  })
  @RateLimit({ name: 'auth:verify-email:ip', scope: 'ip', limit: 10, windowSeconds: 3600 })
  public async verifyEmail(@Body() body: VerifyEmailDto): Promise<EmailConfirmationResult> {
    return this.auth.confirmEmail(body.token);
  }
}

/** Client context recorded with a session. Never used for authorization. */
function contextOf(request: Request): RequestContext {
  const userAgent = request.headers['user-agent'];

  return {
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    // 45 characters is the longest text form of an IPv6 address, which is the
    // widest value the column can hold.
    ipAddress:
      typeof request.ip === 'string' && request.ip.length > 0 ? request.ip.slice(0, 45) : null,
  };
}
