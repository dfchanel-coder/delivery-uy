import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { CityResponse } from '@deliveryuy/types';
import { GeoService } from './geo.service.js';

/**
 * Geographic reference data.
 *
 * Authentication is the only requirement: the list is non-sensitive reference
 * data that a client needs in order to choose a city, and it carries no
 * per-user information (docs/API_RULES.md "Endpoint Security": an authenticated
 * route states that much and nothing more).
 */
@ApiTags('geo')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token.' })
@Controller('geo')
export class GeoController {
  public constructor(private readonly geo: GeoService) {}

  @Get('cities')
  @ApiOperation({ summary: 'Cities a client may operate in, alphabetically.' })
  @ApiOkResponse({ description: 'The enabled cities.' })
  public async cities(): Promise<readonly CityResponse[]> {
    const cities = await this.geo.listCities();

    return cities.map((city) => ({
      id: city.id,
      countryCode: city.countryCode,
      name: city.name,
      departmentOrState: city.departmentOrState,
      timezone: city.timezone,
      currency: city.currency,
      isDefault: city.isDefault,
    }));
  }
}
