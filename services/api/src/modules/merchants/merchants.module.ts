import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { MerchantReviewController } from './merchant-review.controller.js';
import { MerchantsController } from './merchants.controller.js';
import { MerchantsService } from './merchants.service.js';
import { MERCHANT_REPOSITORY } from './merchants.tokens.js';
import { PrismaMerchantRepository } from './infrastructure/prisma-merchant.repository.js';

/**
 * Merchant registration, profile and review (AGENTS.md section 10).
 *
 * Dependencies follow docs/MODULE_BOUNDARIES.md: `auth` grants the onboarding
 * role, `geo` resolves the city, `audit` records the review. The service is
 * exported so a future `orders` module can ask whether a merchant is accepting
 * orders without touching `merchants` tables.
 */
@Module({
  imports: [AuditModule, AuthModule, GeoModule],
  controllers: [MerchantsController, MerchantReviewController],
  providers: [
    MerchantsService,
    { provide: MERCHANT_REPOSITORY, useClass: PrismaMerchantRepository },
  ],
  exports: [MerchantsService],
})
export class MerchantsModule {}
