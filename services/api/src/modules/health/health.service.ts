import { Injectable, Logger } from '@nestjs/common';
import { checkDatabaseHealth, createDatabaseClient, type PrismaClient } from '@deliveryuy/database';
import type { HealthDependencyStatus, HealthLiveness, HealthReadiness } from '@deliveryuy/types';
import Redis from 'ioredis';
import { AppConfigService } from '../../common/config/app-config.service.js';

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} check timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Health checks.
 *
 * `liveness` proves the process can serve requests and must not touch
 * infrastructure: a database outage must never cause a restart loop.
 * `readiness` performs real round trips against PostgreSQL and Redis
 * (ADR-016: a successful HTTP response alone is not enough).
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startedAt = Date.now();

  public constructor(private readonly config: AppConfigService) {}

  public liveness(): HealthLiveness {
    return {
      status: 'ok',
      service: this.config.service.name,
      environment: this.config.get().env,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  public async readiness(
    client: PrismaClient,
    redis: Redis,
    timeoutMs = this.config.health.timeoutMs,
  ): Promise<HealthReadiness> {
    const [database, redisHealth] = await Promise.all([
      withTimeout(checkDatabaseHealth(client, timeoutMs), timeoutMs, 'database'),
      this.checkRedis(redis, timeoutMs),
    ]);

    const status = database.status === 'up' && redisHealth.status === 'up' ? 'ready' : 'degraded';

    if (status === 'degraded') {
      this.logger.warn({ database, redis: redisHealth }, 'Readiness check failed');
    }

    return {
      status,
      dependencies: { database, redis: redisHealth },
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Full readiness probe, including client lifecycle.
   *
   * Controllers never create or close infrastructure clients, and a failed
   * connection must be reported as `degraded` (HTTP 503) instead of escaping as
   * an unhandled error (HTTP 500).
   */
  public async checkReadiness(): Promise<HealthReadiness> {
    const client = this.createDatabaseClient();
    const redis = this.createRedisClient();

    try {
      return await this.readiness(client, redis);
    } finally {
      await Promise.all([
        this.closeQuietly(() => client.$disconnect()),
        this.closeQuietly(() => redis.quit()),
      ]);
    }
  }

  /** Clients are created here so controllers never construct infrastructure. */
  public createDatabaseClient(): PrismaClient {
    const { url, poolSize } = this.config.database;
    return createDatabaseClient({ url, poolSize, logLevel: 'error' });
  }

  public createRedisClient(): Redis {
    const redis = new Redis(this.config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null,
    });

    // ioredis emits `error` on every failed attempt. Without a listener the
    // event would become an unhandled error and take the process down instead
    // of degrading the probe.
    redis.on('error', (error: Error) => {
      this.logger.debug(`Redis client error: ${error.message}`);
    });

    return redis;
  }

  private async checkRedis(redis: Redis, timeoutMs: number): Promise<HealthDependencyStatus> {
    const startedAt = Date.now();

    try {
      await withTimeout(redis.connect(), timeoutMs, 'redis');
      await withTimeout(redis.ping(), timeoutMs, 'redis');
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (error: unknown) {
      return {
        status: 'down',
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : 'unknown redis error',
      };
    }
  }

  /** Closing a client must never replace the health verdict with an error. */
  private async closeQuietly(close: () => Promise<unknown>): Promise<void> {
    try {
      await close();
    } catch (error: unknown) {
      this.logger.debug(`Ignoring close failure: ${String(error)}`);
    }
  }
}
