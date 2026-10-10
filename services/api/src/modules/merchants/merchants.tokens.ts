import type { InjectionToken } from '@nestjs/common';
import type { MerchantRepository } from './ports.js';

/** Injection token for the merchant port. */
export const MERCHANT_REPOSITORY: InjectionToken<MerchantRepository> =
  'DELIVERYUY_MERCHANT_REPOSITORY';
