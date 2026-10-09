import { Module } from '@nestjs/common';
import { PrismaFeatureFlagRepository } from './infrastructure/prisma-feature-flag.repository.js';
import { PlatformService } from './platform.service.js';
import { FEATURE_FLAG_REPOSITORY } from './platform.tokens.js';

/**
 * Platform configuration (AGENTS.md sections 52, 53).
 *
 * Exposes application service methods only. The admin endpoints depend on
 * `PlatformService`, never on `feature_flags`, which keeps the table's owner in
 * one place (docs/MODULE_BOUNDARIES.md).
 */
@Module({
  providers: [
    PrismaFeatureFlagRepository,
    { provide: FEATURE_FLAG_REPOSITORY, useExisting: PrismaFeatureFlagRepository },
    PlatformService,
  ],
  exports: [PlatformService],
})
export class PlatformModule {}
