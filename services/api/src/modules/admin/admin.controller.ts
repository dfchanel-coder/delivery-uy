import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type {
  AdminAuditLog,
  AdminFeatureFlag,
  AdminPanelSummary,
  AdminRiskEvent,
} from '@deliveryuy/types';
import type { Request } from 'express';
import type { AuditActor } from '../audit/audit.ports.js';
import type { PagedResult } from '../../common/pagination/paged-result.js';
import { REQUEST_ID_HEADER } from '../../common/middleware/request-id.middleware.js';
import {
  Permissions,
  principalFromRequest,
  RateLimit,
  type RequestWithPrincipal,
} from '../../common/security/endpoint-security.js';
import { AdminService } from './admin.service.js';
import {
  AdminAuditLogQueryDto,
  AdminFeatureFlagKeyDto,
  AdminRiskEventQueryDto,
  SetFeatureFlagDto,
} from './dto/admin.dto.js';

/**
 * Administrative endpoints (AGENTS.md sections 12, 70, 93).
 *
 * Every route names the `admin:*` permission it requires rather than a role, so
 * a privileged capability can be granted to `SUPPORT` or `FINANCE` without
 * touching this file, and a new role never inherits access by accident. The
 * matrix in `packages/auth` is the single authority.
 *
 * The controller parses, validates and delegates only; every rule lives in
 * `AdminService` and the services it calls.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
@ApiForbiddenResponse({ description: 'The caller does not hold the required permission.' })
@Controller('admin')
export class AdminController {
  public constructor(private readonly admin: AdminService) {}

  @Get('panel')
  @Permissions('admin:panel:read')
  @ApiOperation({ summary: 'Aggregate counts for the admin dashboard.' })
  @ApiOkResponse({ description: 'Panel counts.' })
  public panel(): Promise<AdminPanelSummary> {
    return this.admin.panel();
  }

  @Get('audit-logs')
  @Permissions('admin:audit:read')
  @ApiOperation({ summary: 'Paginated audit trail, newest first.' })
  @ApiOkResponse({ description: 'A page of audit entries.' })
  public auditLogs(@Query() query: AdminAuditLogQueryDto): Promise<PagedResult<AdminAuditLog>> {
    return this.admin.listAuditLogs(query);
  }

  @Get('risk-events')
  @Permissions('admin:risk-events:read')
  @ApiOperation({ summary: 'Paginated neutral risk signals, newest first.' })
  @ApiOkResponse({ description: 'A page of risk events.' })
  public riskEvents(@Query() query: AdminRiskEventQueryDto): Promise<PagedResult<AdminRiskEvent>> {
    return this.admin.listRiskEvents(query);
  }

  @Get('feature-flags')
  @Permissions('admin:panel:read')
  @ApiOperation({ summary: 'List runtime feature flags.' })
  @ApiOkResponse({ description: 'Every configured flag.' })
  public featureFlags(): Promise<readonly AdminFeatureFlag[]> {
    return this.admin.listFeatureFlags();
  }

  @Patch('feature-flags/:key')
  @Permissions('admin:feature-flags:write')
  @RateLimit({ name: 'admin:feature-flags:write', scope: 'user', limit: 30, windowSeconds: 60 })
  @ApiOperation({ summary: 'Toggle one feature flag and record the change.' })
  @ApiOkResponse({ description: 'The flag in its new state.' })
  @ApiNotFoundResponse({ description: 'No flag has that key.' })
  public setFeatureFlag(
    @Param() params: AdminFeatureFlagKeyDto,
    @Body() body: SetFeatureFlagDto,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<AdminFeatureFlag> {
    return this.admin.setFeatureFlagEnabled(actorOf(request), params.key, body.enabled);
  }
}

/**
 * Builds the audit actor from the verified request.
 *
 * The role is read from the token, not from a header or the body, so a caller
 * cannot claim a role it does not hold. A user with several roles records the
 * first; the full role list lives on the account, which is what an investigation
 * consults to know the others (AGENTS.md section 29).
 */
function actorOf(request: Request & RequestWithPrincipal): AuditActor {
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
