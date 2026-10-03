import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_PREFIX, configureApp } from '../../bootstrap.js';
import { AppModule } from '../../app.module.js';
import { APP_CONFIG } from '../../common/config/app-config.module.js';
import { testAppConfig, type DeepPartial } from '../../testing/app-config.fixture.js';
import type { AppConfig } from '@deliveryuy/config';
import {
  FakeClock,
  InMemoryPasswordResetTokenRepository,
  InMemoryRiskEventRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  InMemoryVerificationTokenRepository,
  RecordingEmailVerificationNotifier,
  RecordingPasswordRecoveryNotifier,
} from '../../testing/auth-doubles.js';
import {
  CLOCK,
  EMAIL_VERIFICATION_NOTIFIER,
  PASSWORD_RECOVERY_NOTIFIER,
  PASSWORD_RESET_TOKEN_REPOSITORY,
  RISK_EVENT_REPOSITORY,
  SESSION_REPOSITORY,
  USER_REPOSITORY,
  VERIFICATION_TOKEN_REPOSITORY,
} from './auth.tokens.js';

/**
 * Authentication over real HTTP.
 *
 * What the service tests cannot cover: the guard chain, the global pipes, the
 * error envelope, the documented status codes and the rate limits. The
 * persistence ports are replaced with the in-memory doubles so no PostgreSQL is
 * needed; the Prisma adapters themselves are covered by the integration job.
 */

const AUTH_PATH = `/${API_PREFIX}/auth`;
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a whole new passphrase';
const EMAIL = 'person@example.com';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

interface WireUser {
  id: string;
  email: string;
  status: string;
  roles: string[];
}

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
  users: InMemoryUserRepository;
  sessions: InMemorySessionRepository;
  notifier: RecordingPasswordRecoveryNotifier;
  verificationNotifier: RecordingEmailVerificationNotifier;
  verificationTokens: InMemoryVerificationTokenRepository;
  clock: FakeClock;
}

let harness: Harness;

async function startApp(configOverrides: DeepPartial<AppConfig> = {}): Promise<Harness> {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const resetTokens = new InMemoryPasswordResetTokenRepository();
  const riskEvents = new InMemoryRiskEventRepository();
  const notifier = new RecordingPasswordRecoveryNotifier();
  const verificationNotifier = new RecordingEmailVerificationNotifier();
  const verificationTokens = new InMemoryVerificationTokenRepository();
  const clock = new FakeClock();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(SESSION_REPOSITORY)
    .useValue(sessions)
    .overrideProvider(PASSWORD_RESET_TOKEN_REPOSITORY)
    .useValue(resetTokens)
    .overrideProvider(RISK_EVENT_REPOSITORY)
    .useValue(riskEvents)
    .overrideProvider(PASSWORD_RECOVERY_NOTIFIER)
    .useValue(notifier)
    .overrideProvider(EMAIL_VERIFICATION_NOTIFIER)
    .useValue(verificationNotifier)
    .overrideProvider(VERIFICATION_TOKEN_REPOSITORY)
    .useValue(verificationTokens)
    .overrideProvider(CLOCK)
    .useValue(clock)
    // Overridden so a test can flip a deployment decision - here, that
    // verification is required - without mutating the environment of the whole
    // process, which the other suites in this file rely on.
    .overrideProvider(APP_CONFIG)
    .useValue(testAppConfig(configOverrides))
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return { app, users, sessions, notifier, verificationNotifier, verificationTokens, clock };
}

function server(): ReturnType<INestApplication['getHttpServer']> {
  return harness.app.getHttpServer();
}

async function register(email = EMAIL, password = PASSWORD): Promise<Tokens> {
  const response = await request(server()).post(`${AUTH_PATH}/register`).send({ email, password });

  return (
    data<{ tokens: Tokens | null }>(response.body).tokens ?? { accessToken: '', refreshToken: '' }
  );
}

async function login(email = EMAIL, password = PASSWORD): Promise<Tokens> {
  const response = await request(server()).post(`${AUTH_PATH}/login`).send({ email, password });

  return data<{ tokens: Tokens }>(response.body).tokens;
}

beforeEach(async () => {
  harness = await startApp();
});

afterEach(async () => {
  await harness.app.close();
});

describe('POST /auth/register', () => {
  it('creates an account and answers 201 with a session', async () => {
    const response = await request(server()).post(`${AUTH_PATH}/register`).send({
      email: EMAIL,
      password: PASSWORD,
    });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(data<{ verificationRequired: boolean }>(response.body).verificationRequired).toBe(false);
    expect(data<{ tokens: Tokens }>(response.body).tokens.accessToken).toBeTypeOf('string');
  });

  it('rejects a malformed body in the pipe', async () => {
    const response = await request(server())
      .post(`${AUTH_PATH}/register`)
      .send({ email: 'not-an-email', password: PASSWORD });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('rejects unknown fields instead of ignoring them', async () => {
    // A client cannot smuggle a role into a registration.
    const response = await request(server())
      .post(`${AUTH_PATH}/register`)
      .send({ email: EMAIL, password: PASSWORD, role: 'ADMIN' });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });

  it('answers 409 for an address that is already registered', async () => {
    await register();

    const response = await request(server())
      .post(`${AUTH_PATH}/register`)
      .send({ email: EMAIL.toUpperCase(), password: PASSWORD });

    expect(response.status).toBe(HttpStatus.CONFLICT);
    expect(failure(response.body).code).toBe('EMAIL_ALREADY_REGISTERED');
  });
});

describe('POST /auth/login', () => {
  it('answers with a session and the account behind it', async () => {
    await register();

    const response = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ tokens: Tokens }>(response.body).tokens.refreshToken).toBeTypeOf('string');
    expect(data<{ user: WireUser }>(response.body).user).toMatchObject({
      email: EMAIL,
      roles: ['CUSTOMER'],
    });
  });

  it('answers 401 identically for a wrong password and an unknown account', async () => {
    await register();

    const wrongPassword = await request(server())
      .post(`${AUTH_PATH}/login`)
      .send({ email: EMAIL, password: 'wrong password value' });
    const unknownAccount = await request(server())
      .post(`${AUTH_PATH}/login`)
      .send({ email: 'stranger@example.com', password: 'wrong password value' });

    expect(wrongPassword.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(wrongPassword.body).code).toBe('INVALID_CREDENTIALS');
    // The correlation id is per request; everything else must be identical, or
    // the response would tell an attacker which addresses exist.
    expect(failure(unknownAccount.body)).toMatchObject({
      code: failure(wrongPassword.body).code,
      message: failure(wrongPassword.body).message,
    });
  });

  it('never echoes the password or the hash back to the client', async () => {
    await register();

    const response = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });

    expect(JSON.stringify(response.body)).not.toContain('argon2');
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
  });
});

describe('GET /auth/me', () => {
  it('requires a token', async () => {
    const response = await request(server()).get(`${AUTH_PATH}/me`);

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token that this deployment did not sign', async () => {
    const response = await request(server())
      .get(`${AUTH_PATH}/me`)
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.not-a-signature');

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('TOKEN_INVALID');
  });

  it('rejects a scheme other than bearer', async () => {
    const response = await request(server())
      .get(`${AUTH_PATH}/me`)
      .set('Authorization', 'Basic dXNlcjpwYXNz');

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('UNAUTHENTICATED');
  });

  it('answers with the account behind a valid token', async () => {
    await register();
    const tokens = await login();

    const response = await request(server())
      .get(`${AUTH_PATH}/me`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<WireUser>(response.body)).toMatchObject({ email: EMAIL, roles: ['CUSTOMER'] });
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    await register();
    const tokens = await login();

    const response = await request(server())
      .post(`${AUTH_PATH}/refresh`)
      .send({ refreshToken: tokens.refreshToken });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ tokens: Tokens }>(response.body).tokens.refreshToken).not.toBe(
      tokens.refreshToken,
    );
  });

  it('closes the whole family when a rotated token is replayed', async () => {
    await register();
    const tokens = await login();

    const rotated = await request(server())
      .post(`${AUTH_PATH}/refresh`)
      .send({ refreshToken: tokens.refreshToken });
    const replacement = data<{ tokens: Tokens }>(rotated.body).tokens;

    const replay = await request(server())
      .post(`${AUTH_PATH}/refresh`)
      .send({ refreshToken: tokens.refreshToken });
    const survivor = await request(server())
      .post(`${AUTH_PATH}/refresh`)
      .send({ refreshToken: replacement.refreshToken });

    expect(replay.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(replay.body).code).toBe('REFRESH_TOKEN_REUSED');
    // Revoking only the replayed token would leave whoever stole it signed in,
    // so the family goes down with it. That replacement was revoked by the reuse
    // response, not by a rotation, which is why it reports a revoked session
    // rather than another reuse.
    expect(survivor.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(survivor.body).code).toBe('TOKEN_REVOKED');
  });

  it('answers 400 when the token is missing', async () => {
    const response = await request(server()).post(`${AUTH_PATH}/refresh`).send({});

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /auth/logout', () => {
  it('is public, idempotent and closes the session', async () => {
    await register();
    const tokens = await login();

    const first = await request(server())
      .post(`${AUTH_PATH}/logout`)
      .send({ refreshToken: tokens.refreshToken });
    const second = await request(server())
      .post(`${AUTH_PATH}/logout`)
      .send({ refreshToken: tokens.refreshToken });

    expect(first.status).toBe(HttpStatus.NO_CONTENT);
    expect(second.status).toBe(HttpStatus.NO_CONTENT);
    expect(harness.sessions.live()).toHaveLength(1);
  });
});

describe('POST /auth/logout-all', () => {
  it('needs a token and closes every session of the caller', async () => {
    await register();
    const tokens = await login();

    const anonymous = await request(server()).post(`${AUTH_PATH}/logout-all`);
    expect(anonymous.status).toBe(HttpStatus.UNAUTHORIZED);

    const response = await request(server())
      .post(`${AUTH_PATH}/logout-all`)
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(HttpStatus.OK);
    // Registration opened one session and the login another; both belong to the
    // caller and both must go.
    expect(data<{ revokedSessions: number }>(response.body).revokedSessions).toBe(2);
    expect(harness.sessions.live()).toHaveLength(0);
  });
});

describe('password recovery over HTTP', () => {
  it('answers 202 the same way for a known and an unknown address', async () => {
    await register();

    const known = await request(server())
      .post(`${AUTH_PATH}/password/forgot`)
      .send({ email: EMAIL });
    const unknown = await request(server())
      .post(`${AUTH_PATH}/password/forgot`)
      .send({ email: 'stranger@example.com' });

    expect(known.status).toBe(HttpStatus.ACCEPTED);
    expect(unknown.status).toBe(HttpStatus.ACCEPTED);
    expect(unknown.body.data).toEqual(known.body.data);
  });

  it('changes the password and closes the sessions that used the old one', async () => {
    await register();
    const tokens = await login();

    await request(server()).post(`${AUTH_PATH}/password/forgot`).send({ email: EMAIL });
    const token = harness.notifier.lastToken()!;

    const reset = await request(server())
      .post(`${AUTH_PATH}/password/reset`)
      .send({ token, password: NEW_PASSWORD });

    expect(reset.status).toBe(HttpStatus.OK);
    expect(data<{ status: string }>(reset.body).status).toBe('reset');

    const stale = await request(server())
      .post(`${AUTH_PATH}/refresh`)
      .send({ refreshToken: tokens.refreshToken });
    expect(failure(stale.body).code).toBe('TOKEN_REVOKED');

    expect(await login(EMAIL, NEW_PASSWORD)).toBeTruthy();
  });

  it('refuses an unknown token without explaining why', async () => {
    await register();

    const response = await request(server())
      .post(`${AUTH_PATH}/password/reset`)
      .send({ token: 'dyu_prt_not-a-real-token', password: NEW_PASSWORD });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('TOKEN_INVALID');
  });
});

describe('rate limits on the public auth routes', () => {
  // `supertest` reports `status` as a plain number, so comparing it to a
  // `HttpStatus` enum member is an unsafe enum comparison. The value is
  // asserted with `toBe` elsewhere in this file, where no comparison operator
  // is involved.
  const TOO_MANY_REQUESTS = 429;

  it('blocks a burst of login attempts against one account with 429', async () => {
    await register();

    let blocked: ApiError | null = null;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      // Sequential on purpose: the counter has to observe every attempt.
      const response = await request(server())
        .post(`${AUTH_PATH}/login`)
        .send({ email: EMAIL, password: 'wrong password value' });

      if (response.status === TOO_MANY_REQUESTS) {
        blocked = failure(response.body);
        break;
      }
    }

    expect(blocked).not.toBeNull();
    expect(blocked?.code).toBe('RATE_LIMITED');
    expect(blocked?.details).toMatchObject({ limit: expect.any(Number) });
  });

  it('spends a separate budget per address', async () => {
    await register();

    // Two different accounts: the second must not inherit the first one's
    // counter, otherwise one attacker could lock every account from one address.
    for (const email of ['first@example.com', 'second@example.com']) {
      const response = await request(server())
        .post(`${AUTH_PATH}/login`)
        .send({ email, password: 'wrong password value' });

      expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
      expect(failure(response.body).code).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('POST /auth/verify-email', () => {
  /** Restarts the app with a deployment that requires a verified address. */
  async function useVerificationRequired(): Promise<void> {
    await harness.app.close();
    harness = await startApp({ auth: { requireEmailVerification: true } });
  }

  async function registerPending(): Promise<string> {
    const response = await request(server()).post(`${AUTH_PATH}/register`).send({
      email: EMAIL,
      password: PASSWORD,
    });

    expect(response.status).toBe(HttpStatus.CREATED);
    expect(data<{ verificationRequired: boolean }>(response.body).verificationRequired).toBe(true);
    // No session for a pending account: an unverified address must not act.
    expect(data<{ tokens: unknown }>(response.body).tokens).toBeNull();

    const token = harness.verificationNotifier.lastToken();

    if (token === undefined) throw new Error('expected a verification message to be delivered');

    return token;
  }

  it('lets the account sign in once the address is proven', async () => {
    await useVerificationRequired();
    const token = await registerPending();

    expect(harness.users.all()[0]?.status).toBe('PENDING_VERIFICATION');

    // 403 rather than 401: the credentials were right and the account is not
    // usable yet, which is a different thing to tell somebody.
    const denied = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(denied.status).toBe(HttpStatus.FORBIDDEN);

    const response = await request(server()).post(`${AUTH_PATH}/verify-email`).send({ token });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ verified: boolean; canSignIn: boolean }>(response.body)).toEqual({
      verified: true,
      canSignIn: true,
    });

    const allowed = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(allowed.status).toBe(HttpStatus.OK);
    expect(data<{ tokens: Tokens }>(allowed.body).tokens.refreshToken).toBeTypeOf('string');
  });

  it('answers that the account is proven but still held when approval is required', async () => {
    // Two different facts, and the client needs both: showing a sign-in form for
    // an account that cannot sign in is worse than saying nothing.
    await harness.app.close();
    harness = await startApp({
      auth: { requireEmailVerification: true, accountApprovalRequired: true },
    });
    const token = await registerPending();

    const response = await request(server()).post(`${AUTH_PATH}/verify-email`).send({ token });

    expect(response.status).toBe(HttpStatus.OK);
    expect(data<{ verified: boolean; canSignIn: boolean }>(response.body)).toEqual({
      verified: true,
      canSignIn: false,
    });

    const still = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });
    // Refused for the honest reason: proven address, account still held.
    expect(still.status).toBe(HttpStatus.FORBIDDEN);
  });

  it('rejects a code that was never issued', async () => {
    await useVerificationRequired();

    const response = await request(server())
      .post(`${AUTH_PATH}/verify-email`)
      .send({ token: 'vt_0000000000000000000000000000' });

    expect(response.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(response.body).code).toBe('TOKEN_INVALID');
  });

  it('refuses a code a second time', async () => {
    await useVerificationRequired();
    const token = await registerPending();

    const first = await request(server()).post(`${AUTH_PATH}/verify-email`).send({ token });
    expect(first.status).toBe(HttpStatus.OK);

    // Single use: a message that ends up in a shared inbox must not be
    // replayable by whoever received it later.
    const replay = await request(server()).post(`${AUTH_PATH}/verify-email`).send({ token });
    expect(replay.status).toBe(HttpStatus.UNAUTHORIZED);
    expect(failure(replay.body).code).toBe('TOKEN_INVALID');
  });

  it('refuses a malformed body in the pipe', async () => {
    const response = await request(server()).post(`${AUTH_PATH}/verify-email`).send({ token: 42 });

    expect(response.status).toBe(HttpStatus.BAD_REQUEST);
    expect(failure(response.body).code).toBe('VALIDATION_FAILED');
  });
});

describe('observability', () => {
  it('answers every request with a correlation id', async () => {
    const response = await request(server()).post(`${AUTH_PATH}/login`).send({
      email: EMAIL,
      password: PASSWORD,
    });

    expect(response.headers['x-request-id']).toBeTypeOf('string');
  });
});
