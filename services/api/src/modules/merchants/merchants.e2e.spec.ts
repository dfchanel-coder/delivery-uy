import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX, configureApp } from '../../bootstrap.js';
import { AppModule } from '../../app.module.js';
import { UNIT_OF_WORK } from '../../common/database/unit-of-work.js';
import { AccessTokenService } from '../../common/security/security.module.js';
import { InMemoryAuditLogRepository, InMemoryUnitOfWork } from '../../testing/admin-doubles.js';
import { InMemoryUserRepository } from '../../testing/auth-doubles.js';
import {
  InMemoryCityRepository,
  InMemoryMerchantRepository,
} from '../../testing/merchant-doubles.js';
import { AUDIT_LOG_REPOSITORY } from '../audit/audit.tokens.js';
import { USER_REPOSITORY } from '../auth/auth.tokens.js';
import { CITY_REPOSITORY } from '../geo/geo.tokens.js';
import { MERCHANT_REPOSITORY } from './merchants.tokens.js';

/**
 * The merchant surface over real HTTP.
 *
 * What the service tests cannot cover: the guard chain, the global pipes and the
 * response envelope. Persistence is replaced with in-memory doubles so no
 * PostgreSQL is needed; the Prisma adapters are covered by the integration
 * suite. Tokens are signed by the same secret the guard verifies, so
 * authorization is exercised for real.
 */

const MERCHANTS_PATH = `/${API_PREFIX}/merchants`;
const ADMIN_MERCHANTS_PATH = `/${API_PREFIX}/admin/merchants`;

interface ApiError {
  code: string;
  message: string;
}

function data<T>(body: unknown): T {
  const payload = (body as { data?: unknown }).data;

  if (payload === undefined) {
    throw new Error(`expected a data envelope, received ${JSON.stringify(body)}`);
  }

  return payload as T;
}

function failure(body: unknown): ApiError {
  const payload = (body as { error?: ApiError }).error;

  if (payload === undefined) {
    throw new Error(`expected an error envelope, received ${JSON.stringify(body)}`);
  }

  return payload;
}

interface Harness {
  app: INestApplication;
  merchants: InMemoryMerchantRepository;
  users: InMemoryUserRepository;
  cities: InMemoryCityRepository;
}

let harness: Harness;
let cityId: string;

async function startApp(): Promise<Harness> {
  const merchants = new InMemoryMerchantRepository();
  const users = new InMemoryUserRepository();
  const cities = new InMemoryCityRepository();
  const audits = new InMemoryAuditLogRepository();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MERCHANT_REPOSITORY)
    .useValue(merchants)
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(CITY_REPOSITORY)
    .useValue(cities)
    .overrideProvider(AUDIT_LOG_REPOSITORY)
    .useValue(audits)
    .overrideProvider(UNIT_OF_WORK)
    .useValue(new InMemoryUnitOfWork())
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  cityId = cities.seed().id;

  return { app, merchants, users, cities };
}

function server(): ReturnType<INestApplication['getHttpServer']> {
  return harness.app.getHttpServer();
}

async function tokenFor(userId: string, roles: readonly string[]): Promise<string> {
  const issuer = harness.app.get(AccessTokenService);
  const issued = await issuer.issue({ subject: userId, sessionId: 'session-1', roles });

  return issued.token;
}

/** Seeds an account so `AuthService.currentUser` can resolve it. */
function seedAccount(id: string): string {
  harness.users.seed({ id, email: `${id}@example.com`, passwordHash: 'not-used' });

  return id;
}

function registerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cityId,
    tradeName: 'Panadería Central',
    legalName: 'Panadería Central S.A.',
    rut: '211234560019',
    phoneE164: '+59891234567',
    email: 'shop@example.com',
    addressLine: 'Ituzaingó 1234',
    latitude: -30.905417,
    longitude: -55.550278,
    ...overrides,
  };
}

beforeEach(async () => {
  harness = await startApp();
});

afterEach(async () => {
  await harness.app.close();
});

describe('POST /merchants', () => {
  it('requires a token', async () => {
    const response = await request(server()).post(MERCHANTS_PATH).send(registerPayload());

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('registers a business pending review and makes the caller its owner', async () => {
    const ownerId = seedAccount('user-1');
    const token = await tokenFor(ownerId, ['CUSTOMER']);

    const response = await request(server())
      .post(MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send(registerPayload());

    expect(response.status).toBe(HttpStatus.CREATED);

    const merchant = data<{ id: string; status: string; ownerUserId: string }>(response.body);
    expect(merchant.status).toBe('PENDING_REVIEW');
    expect(merchant.ownerUserId).toBe(ownerId);

    const membership = await harness.merchants.findMembership(merchant.id, ownerId);
    expect(membership?.role).toBe('OWNER');
  });

  it('rejects a RUT whose check digit does not match', async () => {
    seedAccount('user-1');
    const token = await tokenFor('user-1', ['CUSTOMER']);

    const response = await request(server())
      .post(MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send(registerPayload({ rut: '211234560010' }));

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown city', async () => {
    seedAccount('user-1');
    const token = await tokenFor('user-1', ['CUSTOMER']);

    const response = await request(server())
      .post(MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send(registerPayload({ cityId: '00000000-0000-4000-8000-000000000000' }));

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects a RUT already registered', async () => {
    seedAccount('user-1');
    harness.merchants.seed({ rutNormalized: '211234560019', ownerUserId: 'someone-else' });
    const token = await tokenFor('user-1', ['CUSTOMER']);

    const response = await request(server())
      .post(MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`)
      .send(registerPayload());

    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(failure(response.body).code).toBe('MERCHANT_RUT_CONFLICT');
  });
});

describe('GET /merchants/mine', () => {
  it('answers 403 for an account without merchant:profile:read', async () => {
    const token = await tokenFor('user-1', ['CUSTOMER']);

    const response = await request(server())
      .get(`${MERCHANTS_PATH}/mine`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('lists the businesses of the merchant', async () => {
    harness.merchants.seed({ ownerUserId: 'user-1', tradeName: 'Uno' });
    harness.merchants.seed({ ownerUserId: 'someone-else', tradeName: 'Dos' });
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .get(`${MERCHANTS_PATH}/mine`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ tradeName: string }[]>(response.body)).toHaveLength(1);
  });
});

describe('GET /merchants/:id', () => {
  it('answers the detail to a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'user-1' });
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .get(`${MERCHANTS_PATH}/${merchant.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ id: string }>(response.body).id).toBe(merchant.id);
  });

  it('answers not-found to a caller that is not a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'someone-else' });
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .get(`${MERCHANTS_PATH}/${merchant.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(failure(response.body).code).toBe('MERCHANT_NOT_FOUND');
  });
});

describe('PATCH /merchants/:id', () => {
  it('updates the profile for the owner', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'user-1' });
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .patch(`${MERCHANTS_PATH}/${merchant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tradeName: 'Nombre Nuevo' });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ tradeName: string }>(response.body).tradeName).toBe('Nombre Nuevo');
  });

  it('answers not-found to a caller that is not a member', async () => {
    const merchant = harness.merchants.seed({ ownerUserId: 'someone-else' });
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .patch(`${MERCHANTS_PATH}/${merchant.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tradeName: 'Nombre Nuevo' });

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(failure(response.body).code).toBe('MERCHANT_NOT_FOUND');
  });
});

describe('admin merchant review', () => {
  it('answers 403 for a merchant without admin:merchants:review', async () => {
    const token = await tokenFor('user-1', ['MERCHANT']);

    const response = await request(server())
      .get(ADMIN_MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('lists registrations with pagination metadata for ADMIN', async () => {
    harness.merchants.seed({ status: 'PENDING_REVIEW' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .get(ADMIN_MERCHANTS_PATH)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);

    const page = data<{ data: unknown[]; meta: { totalCount: number } }>(response.body);
    expect(page.data).toHaveLength(1);
    expect(page.meta.totalCount).toBe(1);
  });

  it('approves a pending registration and records the decision', async () => {
    const merchant = harness.merchants.seed({ status: 'PENDING_REVIEW' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .post(`${ADMIN_MERCHANTS_PATH}/${merchant.id}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ status: string }>(response.body).status).toBe('ACTIVE');
  });

  it('refuses to approve a registration that is already active', async () => {
    const merchant = harness.merchants.seed({ status: 'ACTIVE' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .post(`${ADMIN_MERCHANTS_PATH}/${merchant.id}/approve`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(failure(response.body).code).toBe('MERCHANT_INVALID_STATE');
  });

  it('rejects a registration with a reason', async () => {
    const merchant = harness.merchants.seed({ status: 'PENDING_REVIEW' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .post(`${ADMIN_MERCHANTS_PATH}/${merchant.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Documentación ilegible' });

    expect(response.status).toBe(HttpStatus.OK);

    const rejected = data<{ status: string; rejectionReason: string }>(response.body);
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Documentación ilegible');
  });

  it('rejects a missing rejection reason in the pipe', async () => {
    const merchant = harness.merchants.seed({ status: 'PENDING_REVIEW' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .post(`${ADMIN_MERCHANTS_PATH}/${merchant.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});
