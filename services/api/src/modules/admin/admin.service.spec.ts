import { describe, expect, it } from 'vitest';
import {
  emptyPanelSummary,
  InMemoryAuditLogRepository,
  InMemoryFeatureFlagRepository,
  InMemoryRiskEventReader,
  InMemoryUnitOfWork,
  StubAdminReadModel,
} from '../../testing/admin-doubles.js';
import type { AuditActor } from '../audit/audit.ports.js';
import { AuditService } from '../audit/audit.service.js';
import type { FeatureFlagRecord } from '../platform/platform.ports.js';
import { PlatformService } from '../platform/platform.service.js';
import { AdminService, FEATURE_FLAG_TOGGLED_ACTION } from './admin.service.js';

/**
 * The admin service composes the audit trail and the platform configuration into
 * one privileged command. The two behaviours tested here are the ones a wrong
 * implementation could fake: that the toggle really went through the platform
 * service, and that toggling really wrote an audit entry carrying the actor and
 * both values.
 */

const ACTOR: AuditActor = {
  userId: 'admin-1',
  role: 'SUPER_ADMIN',
  ipAddress: '203.0.113.9',
  userAgent: 'test-agent',
  correlationId: 'request-1',
};

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

interface Context {
  service: AdminService;
  logs: InMemoryAuditLogRepository;
  riskEvents: InMemoryRiskEventReader;
  flags: InMemoryFeatureFlagRepository;
  unitOfWork: InMemoryUnitOfWork;
}

function buildService(): Context {
  const logs = new InMemoryAuditLogRepository();
  const riskEvents = new InMemoryRiskEventReader();
  const flags = new InMemoryFeatureFlagRepository();
  const unitOfWork = new InMemoryUnitOfWork();
  flags.seed(flag());

  const service = new AdminService(
    new StubAdminReadModel({ ...emptyPanelSummary(), usersTotal: 7 }),
    unitOfWork,
    new AuditService(logs, riskEvents),
    new PlatformService(flags),
  );

  return { service, logs, riskEvents, flags, unitOfWork };
}

describe('AdminService panel and lists', () => {
  it('serves the read model summary', async () => {
    const { service } = buildService();

    await expect(service.panel()).resolves.toMatchObject({ usersTotal: 7 });
  });

  it('delegates audit and risk lists to the audit service', async () => {
    const logs = new InMemoryAuditLogRepository();
    const riskEvents = new InMemoryRiskEventReader([
      {
        id: 'risk-1',
        subjectType: 'USER',
        subjectId: 'user-1',
        type: 'REFRESH_TOKEN_REUSE',
        severity: 'MEDIUM',
        metadata: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const flags = new InMemoryFeatureFlagRepository();
    const service = new AdminService(
      new StubAdminReadModel({ ...emptyPanelSummary(), usersTotal: 7 }),
      new InMemoryUnitOfWork(),
      new AuditService(logs, riskEvents),
      new PlatformService(flags),
    );

    const audits = await service.listAuditLogs({ limit: 5 });
    const risks = await service.listRiskEvents({ limit: 5 });

    expect(audits.items).toEqual([]);
    expect(risks.items).toHaveLength(1);
  });

  it('delegates the flag list', async () => {
    const { service, flags } = buildService();
    flags.seed(flag({ key: 'tips', enabled: true }));

    const items = await service.listFeatureFlags();

    expect(items.map((item) => item.key)).toEqual(['cashPayments', 'tips']);
  });
});

describe('AdminService.setFeatureFlagEnabled', () => {
  it('toggles the flag in the repository and returns its new state', async () => {
    const { service, flags } = buildService();

    const after = await service.setFeatureFlagEnabled(ACTOR, 'cashPayments', true);

    expect(after.enabled).toBe(true);
    expect((await flags.list()).find((item) => item.key === 'cashPayments')?.enabled).toBe(true);
  });

  it('writes one audit entry with the actor and both values', async () => {
    const { service, logs } = buildService();

    await service.setFeatureFlagEnabled(ACTOR, 'cashPayments', true);

    expect(logs.written).toHaveLength(1);
    expect(logs.written[0]).toMatchObject({
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      action: FEATURE_FLAG_TOGGLED_ACTION,
      entityType: 'FeatureFlag',
      entityId: 'cashPayments',
      metadata: { enabled: true, previousEnabled: false },
      ipAddress: '203.0.113.9',
      userAgent: 'test-agent',
      correlationId: 'request-1',
    });
  });

  it('runs the flag write and the audit write inside one unit of work', async () => {
    const { service, unitOfWork, flags, logs } = buildService();

    await service.setFeatureFlagEnabled(ACTOR, 'cashPayments', true);

    expect(unitOfWork.transactions).toBe(1);
    expect((await flags.list()).find((item) => item.key === 'cashPayments')?.enabled).toBe(true);
    expect(logs.written).toHaveLength(1);
  });

  it('does not write an audit entry when the flag does not exist', async () => {
    const { service, logs } = buildService();

    const error = await service
      .setFeatureFlagEnabled(ACTOR, 'missing', true)
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'NOT_FOUND' });
    expect(logs.written).toHaveLength(0);
  });
});
