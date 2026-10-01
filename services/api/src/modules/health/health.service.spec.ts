import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@deliveryuy/database';
import type Redis from 'ioredis';
import { HealthService } from './health.service.js';
import { AppConfigService } from '../../common/config/app-config.service.js';

function buildConfigService(): AppConfigService {
  return new AppConfigService({
    env: 'test',
    isProduction: false,
    service: {
      name: 'api',
      port: 3000,
      internalPort: 3001,
      url: 'http://localhost:3000',
      bodyLimit: '1mb',
      corsOrigins: [],
    },
    database: { url: 'postgresql://localhost:5432/test', poolSize: 1 },
    redis: { url: 'redis://localhost:6379' },
    health: { timeoutMs: 100 },
    auth: {
      accessSecret: 'a'.repeat(40),
      refreshSecret: 'b'.repeat(40),
      accessExpiresIn: '15m',
      refreshExpiresIn: '30d',
      issuer: 'deliveryuy',
      audience: 'deliveryuy-clients',
      loginMaxAttempts: 5,
      loginLockMinutes: 15,
      passwordArgon2MemoryKib: 65536,
      passwordArgon2Iterations: 3,
      passwordMinLength: 10,
    },
    deliveryCode: {
      length: 6,
      numericOnly: true,
      ttlHours: 24,
      maxAttempts: 5,
      lockMinutes: 15,
    },
    dispatch: {
      strategy: 'proximity-v1',
      batchSize: 5,
      offerTtlSeconds: 45,
      maxRounds: 10,
      crossCity: false,
    },
    gps: {
      intervalSeconds: 5,
      positionTtlSeconds: 120,
      historyEnabled: false,
      historyRetentionHours: 24,
    },
    defaults: { country: 'UY', currency: 'UYU', timezone: 'America/Montevideo' },
    retention: {
      runtimeConfigCacheSeconds: 30,
      sessionDays: 30,
      idempotencyDays: 7,
      webhookEventDays: 30,
      outboxDays: 7,
    },
    providers: {
      map: { provider: 'none' },
      payment: { provider: 'none' },
      billing: { provider: 'none' },
      notification: { provider: 'none' },
      storage: { provider: 'local', localPath: './var/storage' },
    },
    observability: { logLevel: 'silent', otelEnabled: false },
    featureFlags: {},
  });
}

function fakeDatabase(behaviour: 'up' | 'down'): PrismaClient {
  return {
    $queryRawUnsafe: vi.fn(async () => {
      if (behaviour === 'down') throw new Error('connection refused');
      return [{ ok: 1 }];
    }),
    $disconnect: vi.fn(async () => undefined),
  } as unknown as PrismaClient;
}

function fakeRedis(behaviour: 'up' | 'down' | 'slow' | 'refusesConnection'): Redis {
  return {
    ping: vi.fn(async () => {
      if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 500));
      if (behaviour === 'down') throw new Error('redis unavailable');
      return 'PONG';
    }),
    connect: vi.fn(async () => {
      if (behaviour === 'refusesConnection') throw new Error('Connection is closed.');
      return undefined;
    }),
    quit: vi.fn(async () => 'OK'),
  } as unknown as Redis;
}

describe('HealthService.liveness', () => {
  it('reports ok without creating any client', () => {
    const service = new HealthService(buildConfigService());
    const report = service.liveness();

    expect(report.status).toBe('ok');
    expect(report.service).toBe('api');
    expect(report.environment).toBe('test');
  });
});

describe('HealthService.readiness', () => {
  it('is ready when PostgreSQL and Redis answer', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('up'), fakeRedis('up'));

    expect(report.status).toBe('ready');
    expect(report.dependencies.database.status).toBe('up');
    expect(report.dependencies.redis.status).toBe('up');
  });

  it('degrades when the database is unreachable', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('down'), fakeRedis('up'));

    expect(report.status).toBe('degraded');
    expect(report.dependencies.database.status).toBe('down');
    expect(report.dependencies.redis.status).toBe('up');
  });

  it('degrades when Redis is unreachable', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('up'), fakeRedis('down'));

    expect(report.status).toBe('degraded');
    expect(report.dependencies.redis.status).toBe('down');
  });

  it('applies the configured timeout instead of hanging', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('up'), fakeRedis('slow'), 50);

    expect(report.dependencies.redis.status).toBe('down');
    expect(report.dependencies.redis.error).toContain('timed out');
  });

  it('returns an ISO timestamp for observability', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('up'), fakeRedis('up'));

    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
  });

  it('reports degraded when Redis refuses the connection', async () => {
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('up'), fakeRedis('refusesConnection'));

    expect(report.status).toBe('degraded');
    expect(report.dependencies.redis.status).toBe('down');
    expect(report.dependencies.redis.error).toContain('Connection is closed');
  });
});

describe('HealthService.checkReadiness', () => {
  it('reports degraded and closes its clients when infrastructure is down', async () => {
    const service = new HealthService(buildConfigService());
    const database = fakeDatabase('down');
    const redis = fakeRedis('refusesConnection');

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(database);
    vi.spyOn(service, 'createRedisClient').mockReturnValue(redis);

    const report = await service.checkReadiness();

    expect(report.status).toBe('degraded');
    expect(database.$disconnect).toHaveBeenCalledOnce();
    expect(redis.quit).toHaveBeenCalledOnce();
  });

  it('never throws when closing a client fails', async () => {
    const service = new HealthService(buildConfigService());
    const database = fakeDatabase('up');
    const redis = fakeRedis('up');

    (database as { $disconnect: () => Promise<void> }).$disconnect = vi.fn(() => {
      throw new Error('socket already destroyed');
    });

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(database);
    vi.spyOn(service, 'createRedisClient').mockReturnValue(redis);

    await expect(service.checkReadiness()).resolves.toMatchObject({ status: 'ready' });
    expect(redis.quit).toHaveBeenCalledOnce();
  });
});

describe('HealthController.readiness', () => {
  it('returns the report when every dependency answers', async () => {
    const service = new HealthService(buildConfigService());
    const { HealthController } = await import('./health.controller.js');
    const controller = new HealthController(service);

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(fakeDatabase('up'));
    vi.spyOn(service, 'createRedisClient').mockReturnValue(fakeRedis('up'));

    await expect(controller.readiness()).resolves.toMatchObject({ status: 'ready' });
  });

  it('throws ServiceUnavailableException when dependencies are degraded', async () => {
    const service = new HealthService(buildConfigService());
    const controller = new (await import('./health.controller.js')).HealthController(service);

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(fakeDatabase('down'));
    vi.spyOn(service, 'createRedisClient').mockReturnValue(fakeRedis('down'));

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('always closes the clients it created', async () => {
    const database = fakeDatabase('up');
    const redis = fakeRedis('up');

    const service = new HealthService(buildConfigService());
    const { HealthController } = await import('./health.controller.js');
    const controller = new HealthController(service);

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(database);
    vi.spyOn(service, 'createRedisClient').mockReturnValue(redis);

    await controller.readiness();

    expect(database.$disconnect).toHaveBeenCalledOnce();
    expect(redis.quit).toHaveBeenCalledOnce();
  });
});
