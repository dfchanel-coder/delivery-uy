import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { MerchantDetailResponse, MerchantSummaryResponse } from '@deliveryuy/types';
import type { Request } from 'express';
import { auditActorFromRequest } from '../audit/audit-actor.js';
import {
  Permissions,
  principalFromRequest,
  RateLimit,
  type RequestWithPrincipal,
} from '../../common/security/endpoint-security.js';
import { RegisterMerchantDto, UpdateMerchantProfileDto } from './dto/merchants.dto.js';
import { toMerchantDetail, toMerchantSummary } from './merchants.mapper.js';
import { MerchantsService } from './merchants.service.js';

/**
 * The merchant-facing surface (AGENTS.md section 10).
 *
 * `POST /merchants` needs authentication and nothing more: it is how an account
 * becomes a merchant, so requiring the `MERCHANT` permission here would be
 * circular. Every other route names the permission it needs and resolves the
 * business from the caller's membership, never from a client-supplied owner id
 * (AGENTS.md section 32).
 */
@ApiTags('merchants')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
@Controller('merchants')
export class MerchantsController {
  public constructor(private readonly merchants: MerchantsService) {}

  @Post()
  @RateLimit({ name: 'merchants:register', scope: 'user', limit: 10, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Register a business for the authenticated account.' })
  @ApiCreatedResponse({ description: 'The business, in `PENDING_REVIEW`.' })
  @ApiForbiddenResponse({ description: 'The account is not active.' })
  public async register(
    @Body() body: RegisterMerchantDto,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<MerchantDetailResponse> {
    const merchant = await this.merchants.register(
      {
        cityId: body.cityId,
        tradeName: body.tradeName,
        legalName: body.legalName,
        rut: body.rut,
        description: body.description,
        phoneE164: body.phoneE164,
        email: body.email,
        addressLine: body.addressLine,
        latitude: body.latitude,
        longitude: body.longitude,
      },
      auditActorFromRequest(request),
    );

    return toMerchantDetail(merchant);
  }

  @Get('mine')
  @Permissions('merchant:profile:read')
  @ApiOperation({ summary: 'Businesses the authenticated account belongs to.' })
  @ApiOkResponse({ description: "The caller's businesses, newest first." })
  public async mine(
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<readonly MerchantSummaryResponse[]> {
    const principal = principalFromRequest(request);
    const merchants = await this.merchants.listMine(principal.userId);

    return merchants.map(toMerchantSummary);
  }

  @Get(':id')
  @Permissions('merchant:profile:read')
  @ApiOperation({ summary: 'One business the authenticated account belongs to.' })
  @ApiOkResponse({ description: 'The business.' })
  @ApiNotFoundResponse({ description: 'No such business, or the caller is not a member.' })
  public async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<MerchantDetailResponse> {
    const principal = principalFromRequest(request);

    return toMerchantDetail(await this.merchants.getForMember(id, principal.userId));
  }

  @Patch(':id')
  @Permissions('merchant:profile:manage')
  @RateLimit({ name: 'merchants:update-profile', scope: 'user', limit: 60, windowSeconds: 3600 })
  @ApiOperation({ summary: 'Update a business the caller owns or manages.' })
  @ApiOkResponse({ description: 'The updated business.' })
  @ApiNotFoundResponse({ description: 'No such business, or the caller is not a member.' })
  public async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateMerchantProfileDto,
    @Req() request: Request & RequestWithPrincipal,
  ): Promise<MerchantDetailResponse> {
    const principal = principalFromRequest(request);

    const merchant = await this.merchants.updateProfile(id, principal.userId, {
      tradeName: body.tradeName,
      legalName: body.legalName,
      description: body.description,
      phoneE164: body.phoneE164,
      email: body.email,
      addressLine: body.addressLine,
      latitude: body.latitude,
      longitude: body.longitude,
    });

    return toMerchantDetail(merchant);
  }
}
