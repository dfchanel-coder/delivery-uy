import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX, configureApp } from '../../bootstrap.js';
import { AppModule } from '../../app.module.js';
import { AccessTokenService } from '../../common/security/security.module.js';
import { InMemoryUserAdminRepository } from '../../testing/user-admin-doubles.js';
import { USER_ADMIN_REPOSITORY } from './users.tokens.js';

/**
 * User administration over real HTTP.
 *
 * What the service tests cannot cover: the guard chain, the global pipes and
 * the response envelope. The persistence port is replaced with the in-memory
 * double so no PostgreSQL is needed; `PrismaUserAdminRepository` is covered by
 * the integration suite. Authorization is read from the verified token claims
 * (not from the database), so a token issued here exercises the real guards.
 */

const USERS_PATH = `/${API_PREFIX}/users`;

interface ApiError {
  code: string;
  message: string;
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
  repository: InMemoryUserAdminRepository;
}

let harness: Harness;

async function startApp(): Promise<Harness> {
  const repository = new InMemoryUserAdminRepository();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USER_ADMIN_REPOSITORY)
    .useValue(repository)
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return { app, repository };
}

function server(): ReturnType<INestApplication['getHttpServer']> {
  return harness.app.getHttpServer();
}

/** Issues a real access token, signed by the same secret the guard verifies. */
async function tokenFor(userId: string, roles: readonly string[]): Promise<string> {
  const issuer = harness.app.get(AccessTokenService);
  const issued = await issuer.issue({ subject: userId, sessionId: 'session-1', roles });

  return issued.token;
}

beforeEach(async () => {
  harness = await startApp();
});

afterEach(async () => {
  await harness.app.close();
});

describe('GET /users', () => {
  it('requires a token', async () => {
    const response = await request(server()).get(USERS_PATH);

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('answers 403 for a role without admin:users:read', async () => {
    const token = await tokenFor('customer-1', ['CUSTOMER']);

    const response = await request(server())
      .get(USERS_PATH)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('lists users with pagination metadata for ADMIN', async () => {
    harness.repository.seed({ email: 'one@example.com' });
    harness.repository.seed({ email: 'two@example.com' });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .get(USERS_PATH)
      .query({ page: 1, limit: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);

    const page = data<{ data: unknown[]; meta: { totalCount: number; hasNextPage: boolean } }>(
      response.body,
    );

    expect(page.data).toHaveLength(1);
    expect(page.meta.totalCount).toBe(2);
    expect(page.meta.hasNextPage).toBe(true);
  });

  it('rejects a limit above the documented maximum in the pipe', async () => {
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .get(USERS_PATH)
      .query({ limit: 101 })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /users/:id', () => {
  it('answers the detail for ADMIN', async () => {
    const user = harness.repository.seed({
      email: 'detail@example.com',
      roles: ['MERCHANT'],
    });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .get(`${USERS_PATH}/${user.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ email: string; roles: string[] }>(response.body)).toMatchObject({
      email: 'detail@example.com',
      roles: ['MERCHANT'],
    });
  });

  it('answers 404 for an unknown id', async () => {
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .get(`${USERS_PATH}/does-not-exist`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(HttpStatus.NOT_FOUND);
    expect(failure(response.body).code).toBe('NOT_FOUND');
  });
});

describe('PATCH /users/:id/roles', () => {
  it('answers 403 for ADMIN, which lacks admin:users:manage', async () => {
    const target = harness.repository.seed({ roles: ['CUSTOMER'] });
    const token = await tokenFor('admin-1', ['ADMIN']);

    const response = await request(server())
      .patch(`${USERS_PATH}/${target.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['MERCHANT'] });

    expect(response.status).toBe(HttpStatus.FORBIDDEN);
    expect(failure(response.body).code).toBe('FORBIDDEN');
  });

  it('updates the roles for SUPER_ADMIN', async () => {
    const target = harness.repository.seed({ roles: ['CUSTOMER'] });
    const token = await tokenFor(harness.repository.seed({ roles: ['SUPER_ADMIN'] }).id, [
      'SUPER_ADMIN',
    ]);

    const response = await request(server())
      .patch(`${USERS_PATH}/${target.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['MERCHANT'] });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ roles: string[] }>(response.body).roles).toEqual(['MERCHANT']);
  });

  it('refuses to revoke SUPER_ADMIN from the last active one', async () => {
    const lastSuperAdmin = harness.repository.seed({ roles: ['SUPER_ADMIN'] });
    const token = await tokenFor(lastSuperAdmin.id, ['SUPER_ADMIN']);

    const response = await request(server())
      .patch(`${USERS_PATH}/${lastSuperAdmin.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['ADMIN'] });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown role in the body', async () => {
    const target = harness.repository.seed({ roles: ['CUSTOMER'] });
    const token = await tokenFor('super-1', ['SUPER_ADMIN']);

    const response = await request(server())
      .patch(`${USERS_PATH}/${target.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roles: ['NOT_A_ROLE'] });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('PATCH /users/:id/status', () => {
  it('suspends another user for SUPER_ADMIN', async () => {
    const target = harness.repository.seed({ roles: ['CUSTOMER'] });
    const token = await tokenFor('super-1', ['SUPER_ADMIN']);

    const response = await request(server())
      .patch(`${USERS_PATH}/${target.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ status: string }>(response.body).status).toBe('SUSPENDED');
  });

  it('rejects an unknown status in the body', async () => {
    const target = harness.repository.seed({ roles: ['CUSTOMER'] });
    const token = await tokenFor('super-1', ['SUPER_ADMIN']);

    const response = await request(server())
      .patch(`${USERS_PATH}/${target.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'GONE' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});
