import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createAccessTokenIssuer, type AccessTokenIssuer, type Role } from '@deliveryuy/auth';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX, configureApp } from '../../bootstrap.js';
import { AppModule } from '../../app.module.js';
import { APP_CONFIG } from '../../common/config/app-config.module.js';
import { UNIT_OF_WORK } from '../../common/database/unit-of-work.js';
import { testAppConfig } from '../../testing/app-config.fixture.js';
import { ADMIN_READ_MODEL } from './admin.tokens.js';
import { AUDIT_LOG_REPOSITORY, RISK_EVENT_READER } from '../audit/audit.tokens.js';
import { FEATURE_FLAG_REPOSITORY } from '../platform/platform.tokens.js';
import {
  emptyPanelSummary,
  InMemoryAuditLogRepository,
  InMemoryFeatureFlagRepository,
  InMemoryRiskEventReader,
  InMemoryUnitOfWork,
  StubAdminReadModel,
} from '../../testing/admin-doubles.js';

/**
 * The admin surface over real HTTP: the exact guard chain, global pipes, error
 * envelope and rate limits the production app uses.
 *
 * This is the proof PHASE 04 was missing - the `RolesGuard`/`PermissionsGuard`
 * pair existed and was unit-tested, but no route exercised it, so nothing on
 * the wire could get a 403. Here every role family takes the real path: the
 * token is signed with the deployment secret, the guards evaluate the frozen
 * matrix, and only a `SUPER_ADMIN` reaches the write endpoint and the audit
 * trail. The persistence ports are the in-memory doubles; the Prisma adapters
 * are covered by the integration job.
 */

const ADMIN_PATH = `/${API_PREFIX}/admin`;
const FLAG_KEY = 'cashPayments';

interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Reads the payload of a successful response. */
function data<T>(body: unknown): T {
  const payload = (body as { data?: unknown }).data;

  if (payload === undefined)
    throw new Error(`expected a data envelope, received ${JSON.stringify(body)}`);

  return payload as T;
}

/** Reads the payload of a failed response. */
function failure(body: unknown): ApiError {
  const payload = (body as { error?: ApiError }).error;

  if (payload === undefined)
    throw new Error(`expected an error envelope, received ${JSON.stringify(body)}`);

  return payload;
}

interface Harness {
  app: INestApplication;
  auditLogs: InMemoryAuditLogRepository;
  flags: InMemoryFeatureFlagRepository;
}

let harness: Harness;
let issuer: AccessTokenIssuer;

async function startApp(): Promise<Harness> {
  const auditLogs = new InMemoryAuditLogRepository();
  const riskEvents = new InMemoryRiskEventReader();
  const flags = new InMemoryFeatureFlagRepository();
  flags.seed({
    key: FLAG_KEY,
    scope: 'GLOBAL',
    scopeRef: null,
    enabled: false,
    rolloutPercentage: 100,
    description: 'Cash on delivery as a payment method.',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ADMIN_READ_MODEL)
    .useValue(new StubAdminReadModel({ ...emptyPanelSummary(), usersTotal: 6 }))
    .overrideProvider(AUDIT_LOG_REPOSITORY)
    .useValue(auditLogs)
    .overrideProvider(RISK_EVENT_READER)
    .useValue(riskEvents)
    .overrideProvider(FEATURE_FLAG_REPOSITORY)
    .useValue(flags)
    .overrideProvider(UNIT_OF_WORK)
    .useValue(new InMemoryUnitOfWork())
    .overrideProvider(APP_CONFIG)
    .useValue(testAppConfig())
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return { app, auditLogs, flags };
}

async function tokenFor(roles: readonly Role[]): Promise<string> {
  const issued = await issuer.issue({
    subject: randomUUID(),
    sessionId: randomUUID(),
    roles,
  });

  return issued.token;
}

function server(): ReturnType<INestApplication['getHttpServer']> {
  return harness.app.getHttpServer();
}

beforeEach(async () => {
  harness = await startApp();
  issuer = createAccessTokenIssuer({
    secret: testAppConfig().auth.accessSecret,
    expiresIn: testAppConfig().auth.accessExpiresIn,
    issuer: testAppConfig().auth.issuer,
    audience: testAppConfig().auth.audience,
  });
});

afterEach(async () => {
  await harness.app.close();
});

describe('authentication and authorization', () => {
  it('rejects a request with no token', async () => {
    const response = await request(server()).get(`${ADMIN_PATH}/panel`);

    expect(response.status).toBe(401);
    expect(failure(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('rejects a client role with FORBIDDEN', async () => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/panel`)
      .set('Authorization', `Bearer ${await tokenFor(['CUSTOMER'])}`);

    expect(response.status).toBe(403);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('rejects a driver role with FORBIDDEN', async () => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/panel`)
      .set('Authorization', `Bearer ${await tokenFor(['DRIVER'])}`);

    expect(response.status).toBe(403);
  });
});

describe('ADMIN capabilities', () => {
  it('reads the panel and the platform surface', async () => {
    const authorization = `Bearer ${await tokenFor(['ADMIN'])}`;

    const panel = await request(server())
      .get(`${ADMIN_PATH}/panel`)
      .set('Authorization', authorization);
    const flags = await request(server())
      .get(`${ADMIN_PATH}/feature-flags`)
      .set('Authorization', authorization);
    const riskEvents = await request(server())
      .get(`${ADMIN_PATH}/risk-events`)
      .set('Authorization', authorization);

    expect(panel.status).toBe(200);
    expect(data<{ usersTotal: number }>(panel.body).usersTotal).toBe(6);
    expect(flags.status).toBe(200);
    expect(riskEvents.status).toBe(200);
  });

  it('cannot read the audit trail', async () => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/audit-logs`)
      .set('Authorization', `Bearer ${await tokenFor(['ADMIN'])}`);

    expect(response.status).toBe(403);
  });

  it('cannot toggle a feature flag', async () => {
    const response = await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', `Bearer ${await tokenFor(['ADMIN'])}`)
      .send({ enabled: true });

    expect(response.status).toBe(403);
  });
});

describe('SUPPORT and FINANCE capabilities', () => {
  it.each(['SUPPORT', 'FINANCE'] as const)('%s reads the panel', async (role) => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/panel`)
      .set('Authorization', `Bearer ${await tokenFor([role])}`);

    expect(response.status).toBe(200);
  });

  it.each(['SUPPORT', 'FINANCE'] as const)('%s cannot read the audit trail', async (role) => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/audit-logs`)
      .set('Authorization', `Bearer ${await tokenFor([role])}`);

    expect(response.status).toBe(403);
  });

  it.each(['SUPPORT', 'FINANCE'] as const)('%s cannot toggle a feature flag', async (role) => {
    const response = await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', `Bearer ${await tokenFor([role])}`)
      .send({ enabled: true });

    expect(response.status).toBe(403);
  });

  it.each(['SUPPORT', 'FINANCE'] as const)('%s cannot read risk events', async (role) => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/risk-events`)
      .set('Authorization', `Bearer ${await tokenFor([role])}`);

    expect(response.status).toBe(403);
  });
});

describe('SUPER_ADMIN capabilities', () => {
  it('toggles a flag and records who did it', async () => {
    const authorization = `Bearer ${await tokenFor(['SUPER_ADMIN'])}`;

    const patch = await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', authorization)
      .send({ enabled: true });

    expect(patch.status).toBe(200);
    expect(data<{ enabled: boolean }>(patch.body).enabled).toBe(true);

    const audit = await request(server())
      .get(`${ADMIN_PATH}/audit-logs`)
      .set('Authorization', authorization);

    expect(audit.status).toBe(200);
    const entries = data<Array<Record<string, unknown>>>(audit.body);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'feature-flag.toggled',
      entityType: 'FeatureFlag',
      entityId: FLAG_KEY,
      actorRole: 'SUPER_ADMIN',
      metadata: { enabled: true, previousEnabled: false },
    });
  });

  it('reports a missing flag as NOT_FOUND and writes no audit entry', async () => {
    const authorization = `Bearer ${await tokenFor(['SUPER_ADMIN'])}`;

    const patch = await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/notAFlag`)
      .set('Authorization', authorization)
      .send({ enabled: true });

    expect(patch.status).toBe(404);
    expect(failure(patch.body).code).toBe('NOT_FOUND');
    expect(harness.auditLogs.written).toHaveLength(0);
  });

  it('toggles twice and pages the audit trail with cursors', async () => {
    const authorization = `Bearer ${await tokenFor(['SUPER_ADMIN'])}`;

    await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', authorization)
      .send({ enabled: true });
    await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', authorization)
      .send({ enabled: false });

    const first = await request(server())
      .get(`${ADMIN_PATH}/audit-logs?limit=1`)
      .set('Authorization', authorization);

    expect(first.status).toBe(200);
    const pageOne = first.body as { data: unknown; pagination: { nextCursor: string | null } };
    expect((pageOne.data as Array<{ metadata: { enabled: boolean } }>)[0]?.metadata.enabled).toBe(
      false,
    );
    expect(pageOne.pagination.nextCursor).not.toBeNull();

    const second = await request(server())
      .get(
        `${ADMIN_PATH}/audit-logs?limit=1&cursor=${encodeURIComponent(pageOne.pagination.nextCursor ?? '')}`,
      )
      .set('Authorization', authorization);

    expect(second.status).toBe(200);
    const pageTwo = second.body as {
      data: unknown;
      pagination: { nextCursor: string | null; hasMore: boolean };
    };
    expect((pageTwo.data as Array<{ metadata: { enabled: boolean } }>)[0]?.metadata.enabled).toBe(
      true,
    );
    expect(pageTwo.pagination.hasMore).toBe(false);
  });

  it('rejects a cursor the server never issued', async () => {
    const response = await request(server())
      .get(`${ADMIN_PATH}/audit-logs?cursor=not-a-cursor`)
      .set('Authorization', `Bearer ${await tokenFor(['SUPER_ADMIN'])}`);

    expect(response.status).toBe(400);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an invalid toggle body', async () => {
    const response = await request(server())
      .patch(`${ADMIN_PATH}/feature-flags/${FLAG_KEY}`)
      .set('Authorization', `Bearer ${await tokenFor(['SUPER_ADMIN'])}`)
      .send({ enabled: 'yes' });

    expect(response.status).toBe(400);
  });
});

describe('response envelopes', () => {
  it('wraps lists in the data + pagination envelope', async () => {
    const authorization = `Bearer ${await tokenFor(['SUPER_ADMIN'])}`;

    const flags = await request(server())
      .get(`${ADMIN_PATH}/feature-flags`)
      .set('Authorization', authorization);
    const audit = await request(server())
      .get(`${ADMIN_PATH}/audit-logs`)
      .set('Authorization', authorization);

    expect(flags.body).toEqual({
      data: [expect.objectContaining({ key: FLAG_KEY })],
    });
    expect(audit.body).toEqual({
      data: [],
      pagination: { nextCursor: null, hasMore: false },
    });
  });
});
