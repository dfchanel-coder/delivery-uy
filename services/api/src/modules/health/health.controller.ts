import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { HealthLiveness, HealthReadiness } from '@deliveryuy/types';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe. Does not touch infrastructure.' })
  @ApiOkResponse({ description: 'Process is alive.' })
  public liveness(): HealthLiveness {
    return this.healthService.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe. Checks PostgreSQL and Redis connectivity.' })
  @ApiOkResponse({ description: 'Service is ready.' })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unreachable.' })
  public async readiness(): Promise<HealthReadiness> {
    const report = await this.healthService.checkReadiness();

    if (report.status === 'degraded') {
      // Infrastructure detail stays in the logs, never in the response body.
      throw new ServiceUnavailableException('Service dependencies are degraded.');
    }

    return report;
  }
}
