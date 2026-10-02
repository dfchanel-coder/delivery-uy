import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppConfigService } from '../config/app-config.service.js';
import { InMemoryRateLimiter, RATE_LIMITER, type RateLimiter } from './rate-limiter.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';

/**
 * Rate limit storage.
 *
 * `RATE_LIMIT_BACKEND=redis` (the default) shares counters across instances.
 * `memory` keeps them in the process, which is only correct for a single
 * instance and is meant for development and tests; choosing it explicitly is
 * what makes that trade-off visible.
 *
 * The Redis client is created here and closed by the module lifecycle, so no
 * controller ever constructs infrastructure.
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: RATE_LIMITER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): RateLimiter => {
        if (config.rateLimit.backend === 'memory') return new InMemoryRateLimiter();

        return new RedisRateLimiter(
          new Redis(config.redis.url, {
            maxRetriesPerRequest: 2,
            // Without a listener a failed connection becomes an unhandled error
            // event and takes the process down instead of degrading the limit.
            lazyConnect: false,
            retryStrategy: (attempt: number) => Math.min(attempt * 200, 2_000),
          }),
        );
      },
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}
