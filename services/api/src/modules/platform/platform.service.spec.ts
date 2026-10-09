import { describe, expect, it } from 'vitest';
import { InMemoryFeatureFlagRepository } from '../../testing/admin-doubles.js';
import type { FeatureFlagRecord } from '../platform/platform.ports.js';
import { PlatformService } from './platform.service.js';

/** Platform service rules, against the in-memory repository. */

function flag(overrides: Partial<FeatureFlagRecord> = {}): FeatureFlagRecord {
  return {
    key: 'cashPayments',
    scope: 'GLOBAL',
    scopeRef: null,
    enabled: false,
    rolloutPercentage: 100,
    description: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PlatformService.listFeatureFlags', () => {
  it('maps records to the wire contract', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    repository.seed(flag());
    const service = new PlatformService(repository);

    const flags = await service.listFeatureFlags();

    expect(flags).toEqual([
      {
        key: 'cashPayments',
        scope: 'GLOBAL',
        scopeRef: null,
        enabled: false,
        rolloutPercentage: 100,
        description: null,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('returns flags in key order', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    repository.seed(flag({ key: 'tips' }));
    repository.seed(flag({ key: 'cashPayments' }));
    const service = new PlatformService(repository);

    const flags = await service.listFeatureFlags();

    expect(flags.map((item) => item.key)).toEqual(['cashPayments', 'tips']);
  });
});

describe('PlatformService.setFeatureFlagEnabled', () => {
  it('returns both sides of the toggle', async () => {
    const repository = new InMemoryFeatureFlagRepository();
    repository.seed(flag());
    const service = new PlatformService(repository);

    const change = await service.setFeatureFlagEnabled('cashPayments', true, 'user-1');

    expect(change.before.enabled).toBe(false);
    expect(change.after.enabled).toBe(true);
    expect(change.after.updatedAt).not.toBe(change.before.updatedAt);
  });

  it('throws NOT_FOUND for a key that does not exist instead of inventing a flag', async () => {
    const service = new PlatformService(new InMemoryFeatureFlagRepository());

    const error = await service
      .setFeatureFlagEnabled('doesNotExist', true, 'user-1')
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Feature flag "doesNotExist" does not exist.',
    });
  });
});
