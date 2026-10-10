import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module.js';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';
import { CITY_REPOSITORY } from './geo.tokens.js';
import { PrismaCityRepository } from './infrastructure/prisma-city.repository.js';

/**
 * Geographic reference data (docs/MODULE_BOUNDARIES.md: `geo` owns `countries`,
 * `cities`, `delivery_zones`).
 *
 * The service is exported so `merchants` can resolve a city without reaching
 * into this module's repository, which is the dependency direction the boundary
 * document allows.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [GeoController],
  providers: [GeoService, { provide: CITY_REPOSITORY, useClass: PrismaCityRepository }],
  exports: [GeoService],
})
export class GeoModule {}
