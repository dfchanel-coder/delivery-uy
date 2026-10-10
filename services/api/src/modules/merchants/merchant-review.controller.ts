import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { MerchantDetailResponse, MerchantListResponse } from '@deliveryuy/types';
import type { Request } from 'express';
import { auditActorFromRequest } from '../audit/audit-actor.js';
import {
  Permissions,
  RateLimit,
  type RequestWithPrincipal,
} from '../../common/security/endpoint-security.js';
import { AdminMerchantListQueryDto, RejectMerchantDto } from './dto/merchants.dto.js';
import { toMerchantDetail, toMerchantSummary } from './merchants.mapper.js';
import { MerchantsService } from './merchants.service.js';

/**
 * Administrative review of merchant registrations (AGENTS.md section 12).
 *
 * The routes live in the `merchants` module - the same way the `users` module
 * owns `GET /users` for administrators - but every one names an `admin:merchants`
 * permission, so being an authenticated merchant grants nothing here. The guard
 * regression is covered by `merchant-review.controller.spec.ts`.
 */
@ApiTags('admin')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
@ApiForbiddenResponse({ description: 'The caller does not hold the required permission.' })
@Controller('admin/merchants')
export class MerchantReviewController {
  public constructor(private readonly merchants: MerchantsService) {}

  @Get()
  @Permissions('admin:merchants:review')
  @ApiOperation({ summary: 'Paginated merchant registrations, newest first.' })
  @ApiOkResponse({ description: 'A page of businesses.' })
  public async list(@Query() query: AdminMerchantListQueryDto): Promise<MerchantListResponse> {
    const page = await this.merchants.listForAdmin({
      page: query.page,
      limit: query.limit,
      status: query.status,
    });

    return {
      data: page.data.map(toMerchantSummary),
      meta: {
        totalCount: page.totalCount,
        page: query.page,
        limit: query.limit,
        hasNextPage: query.page * query.limit < page.totalCount,
      },
    };
  }

  @Get(':id')
  @Permissions('admin:merchants:review')
  @ApiOperation({ summary: 'One merchant registration.' })
  @ApiOkResponse({ description: 'The business.' })
  @ApiNotFoundResponse({ description: 'No business has that id.' })
  public async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<MerchantDetailResponse> {
    return toMerchantDetail(await this.merchants.getForAdmin(id));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin:merchants:review')
  @RateLimit({ name: 'admin:merchants:approve', scope: 'user', limit: 60, windowSeconds: 60 })
  @ApiOperation({ summary: 'Approve a registration and record the decision.' })
  @ApiOkResponse({ description: 'The approved business.' })
  @ApiNotFoundResponse({ description: 'No business has that id.' })
  public async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<MerchantDetailResponse> {
    return toMerchantDetail(await this.merchants.approve(auditActorFromRequest(request), id));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @Permissions('admin:merchants:review')
  @RateLimit({ name: 'admin:merchants:reject', scope: 'user', limit: 60, windowSeconds: 60 })
  @ApiOperation({ summary: 'Reject a registration with a reason and record the decision.' })
  @ApiOkResponse({ description: 'The rejected business.' })
  @ApiNotFoundResponse({ description: 'No business has that id.' })
  public async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: RejectMerchantDto,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<MerchantDetailResponse> {
    return toMerchantDetail(
      await this.merchants.reject(auditActorFromRequest(request), id, body.reason),
    );
  }
}
