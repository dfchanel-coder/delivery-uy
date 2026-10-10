import type { InjectionToken } from '@nestjs/common';
import type { CityRepository } from './ports.js';

/** Injection token for the city port. */
export const CITY_REPOSITORY: InjectionToken<CityRepository> = 'DELIVERYUY_CITY_REPOSITORY';
