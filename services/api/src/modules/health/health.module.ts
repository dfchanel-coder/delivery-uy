import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

/**
 * Operational endpoints.
 *
 * Kept dependency-free so that `GET /api/v1/health/live` works even when the
 * rest of the system is degraded.
 */
@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
