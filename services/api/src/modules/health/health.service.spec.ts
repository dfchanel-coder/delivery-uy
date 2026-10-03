import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaClient } from '@deliveryuy/database';
import type Redis from 'ioredis';
import { HealthService } from './health.service.js';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { testAppConfig } from '../../testing/app-config.fixture.js';

function buildConfigService(): AppConfigService {
  return new AppConfigService(
    testAppConfig({
      // A failed probe must fail fast, so the timeout stays short.
      health: { timeoutMs: 100 },
      observability: { logLevel: 'silent' },
    }),
  );
}

function fakeDatabase(behaviour: 'up' | 'down' | 'slow'): PrismaClient {
  return {
    $queryRawUnsafe: vi.fn(async () => {
      if (behaviour === 'slow') await new Promise((resolve) => setTimeout(resolve, 500));
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

  it('degrades instead of throwing when the database is slower than the budget', async () => {
    // The probe is allowed to be slow, never allowed to fail. A rejection here
    // would escape the controller uncaught and answer 500, telling the operator
    // the API is broken rather than that one dependency exceeded its budget.
    const service = new HealthService(buildConfigService());
    const report = await service.readiness(fakeDatabase('slow'), fakeRedis('up'), 50);

    expect(report.status).toBe('degraded');
    expect(report.dependencies.database.status).toBe('down');
    expect(report.dependencies.database.error).toContain('timed out');
    expect(report.dependencies.redis.status).toBe('up');
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

  it('answers 503, not 500, when a dependency exceeds its budget', async () => {
    // The status code is what an orchestrator and a load balancer read. A slow
    // dependency is a degraded service, not a broken endpoint, and the two
    // provoke different reactions.
    const service = new HealthService(buildConfigService());
    const controller = new (await import('./health.controller.js')).HealthController(service);

    vi.spyOn(service, 'createDatabaseClient').mockReturnValue(fakeDatabase('slow'));
    vi.spyOn(service, 'createRedisClient').mockReturnValue(fakeRedis('up'));

    await expect(controller.readiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
