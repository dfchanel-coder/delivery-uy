import { Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@deliveryuy/types';
import { ApiException } from '../../common/errors/api-exception.js';
import { CITY_REPOSITORY } from './geo.tokens.js';
import type { CityRepository, GeoCityRecord } from './ports.js';

/**
 * Read access to geographic reference data.
 *
 * Other modules (`merchants` today, `customers` and `orders` later) resolve a
 * city through this service instead of touching `cities`, which is what keeps
 * the "who owns which table" rule in docs/MODULE_BOUNDARIES.md true.
 */
@Injectable()
export class GeoService {
  public constructor(@Inject(CITY_REPOSITORY) private readonly cities: CityRepository) {}

  public findCityById(id: string): Promise<GeoCityRecord | null> {
    return this.cities.findById(id);
  }

  /**
   * Resolves a city a request depends on, rejecting the request when it is
   * unknown or disabled.
   *
   * A client-supplied id that matches no enabled city is bad input, not a
   * missing resource: the caller is choosing a value the platform does not
   * offer, so the answer is `VALIDATION_FAILED` rather than `NOT_FOUND`.
   */
  public async requireCity(id: string): Promise<GeoCityRecord> {
    const city = await this.cities.findById(id);

    if (city === null || !city.enabled) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        'The selected city does not exist or is not enabled.',
        { cityId: id },
      );
    }

    return city;
  }

  public listCities(): Promise<readonly GeoCityRecord[]> {
    return this.cities.listEnabled();
  }
}
