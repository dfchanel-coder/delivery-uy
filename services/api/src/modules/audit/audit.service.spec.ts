import { describe, expect, it } from 'vitest';
import { ApiException } from '../../common/errors/api-exception.js';
import { encodeCursor } from '../../common/pagination/cursor.js';
import {
  InMemoryAuditLogRepository,
  InMemoryRiskEventReader,
} from '../../testing/admin-doubles.js';
import { AuditService } from './audit.service.js';
import type { AuditActor, RiskEventRecord } from './audit.ports.js';

/**
 * The audit service is the only writer of the audit trail and the reader an
 * administrator uses to inspect it. Both halves are exercised here against the
 * in-memory doubles; the SQL itself is covered by the integration job.
 */

const ACTOR: AuditActor = {
  userId: 'user-1',
  role: 'SUPER_ADMIN',
  ipAddress: '203.0.113.9',
  userAgent: 'vitest',
  correlationId: 'corr-1',
};

function riskEvent(overrides: Partial<RiskEventRecord> = {}): RiskEventRecord {
  return {
    id: 'risk-1',
    subjectType: 'USER',
    subjectId: 'user-1',
    type: 'REFRESH_TOKEN_REUSE',
    severity: 'MEDIUM',
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AuditService.record', () => {
  it('persists the actor and the entry verbatim', async () => {
    const logs = new InMemoryAuditLogRepository();
    const service = new AuditService(logs, new InMemoryRiskEventReader());

    await service.record(ACTOR, {
      action: 'feature-flag.toggled',
      entityType: 'FeatureFlag',
      entityId: 'cashPayments',
      metadata: { enabled: true },
    });

    expect(logs.written).toHaveLength(1);
    expect(logs.written[0]).toMatchObject({
      actorUserId: 'user-1',
      actorRole: 'SUPER_ADMIN',
      action: 'feature-flag.toggled',
      entityType: 'FeatureFlag',
      entityId: 'cashPayments',
      metadata: { enabled: true },
      ipAddress: '203.0.113.9',
      userAgent: 'vitest',
      correlationId: 'corr-1',
    });
  });

  it('records a null entity id when the action has no single target', async () => {
    const logs = new InMemoryAuditLogRepository();
    const service = new AuditService(logs, new InMemoryRiskEventReader());

    await service.record(ACTOR, {
      action: 'panel.viewed',
      entityType: 'Panel',
      entityId: null,
      metadata: null,
    });

    expect(logs.written[0]?.entityId).toBeNull();
  });
});

describe('AuditService.listAuditLogs', () => {
  it('maps rows to the wire contract, newest first', async () => {
    const logs = new InMemoryAuditLogRepository();
    const service = new AuditService(logs, new InMemoryRiskEventReader());

    await service.record(ACTOR, {
      action: 'a.one',
      entityType: 'X',
      entityId: null,
      metadata: null,
    });
    await service.record(ACTOR, {
      action: 'a.two',
      entityType: 'X',
      entityId: null,
      metadata: null,
    });

    const page = await service.listAuditLogs({ limit: 10 });

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.action).toBe('a.two');
    expect(page.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(page.nextCursor).toBeNull();
  });

  it('returns a cursor only when another page exists', async () => {
    const logs = new InMemoryAuditLogRepository();
    const service = new AuditService(logs, new InMemoryRiskEventReader());

    for (let index = 0; index < 3; index += 1) {
      await service.record(ACTOR, {
        action: `a.${index}`,
        entityType: 'X',
        entityId: null,
        metadata: null,
      });
    }

    const first = await service.listAuditLogs({ limit: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listAuditLogs({ limit: 2, cursor: first.nextCursor ?? undefined });

    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]?.action).toBe('a.0');
  });

  it('filters by action without breaking paging', async () => {
    const logs = new InMemoryAuditLogRepository();
    const service = new AuditService(logs, new InMemoryRiskEventReader());

    await service.record(ACTOR, {
      action: 'keep',
      entityType: 'X',
      entityId: null,
      metadata: null,
    });
    await service.record(ACTOR, {
      action: 'drop',
      entityType: 'X',
      entityId: null,
      metadata: null,
    });

    const page = await service.listAuditLogs({ limit: 10, action: 'keep' });

    expect(page.items.map((entry) => entry.action)).toEqual(['keep']);
  });

  it('rejects a cursor it did not issue', async () => {
    const service = new AuditService(
      new InMemoryAuditLogRepository(),
      new InMemoryRiskEventReader(),
    );

    await expect(
      service.listAuditLogs({ limit: 10, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('accepts a cursor it did issue', async () => {
    const service = new AuditService(
      new InMemoryAuditLogRepository(),
      new InMemoryRiskEventReader(),
    );

    const cursor = encodeCursor({ createdAt: new Date(0), id: 'row' });

    await expect(service.listAuditLogs({ limit: 10, cursor })).resolves.toBeDefined();
  });
});

describe('AuditService.listRiskEvents', () => {
  it('maps risk events and keeps severity neutral', async () => {
    const service = new AuditService(
      new InMemoryAuditLogRepository(),
      new InMemoryRiskEventReader([riskEvent()]),
    );

    const page = await service.listRiskEvents({ limit: 10 });

    expect(page.items[0]).toEqual({
      id: 'risk-1',
      subjectType: 'USER',
      subjectId: 'user-1',
      type: 'REFRESH_TOKEN_REUSE',
      severity: 'MEDIUM',
      metadata: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('filters by type', async () => {
    const service = new AuditService(
      new InMemoryAuditLogRepository(),
      new InMemoryRiskEventReader([
        riskEvent({ id: 'risk-1', type: 'REFRESH_TOKEN_REUSE' }),
        riskEvent({ id: 'risk-2', type: 'CHECKOUT_ANOMALY' }),
      ]),
    );

    const page = await service.listRiskEvents({ limit: 10, type: 'CHECKOUT_ANOMALY' });

    expect(page.items.map((event) => event.id)).toEqual(['risk-2']);
  });

  it('surfaces the same invalid-cursor contract as the audit list', async () => {
    const service = new AuditService(
      new InMemoryAuditLogRepository(),
      new InMemoryRiskEventReader(),
    );

    const error = await service
      .listRiskEvents({ limit: 10, cursor: '@@' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).code).toBe('VALIDATION_FAILED');
  });
});
