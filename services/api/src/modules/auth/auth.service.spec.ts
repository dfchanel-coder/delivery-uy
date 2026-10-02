import { hashPassword, TEST_ARGON2_PARAMETERS } from '@deliveryuy/auth';
import type { AppConfig } from '@deliveryuy/config';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../../common/config/app-config.service.js';
import { ApiException } from '../../common/errors/api-exception.js';
import { AccessTokenService } from '../../common/security/security.module.js';
import { testAppConfig, type DeepPartial } from '../../testing/app-config.fixture.js';
import {
  FakeClock,
  InMemoryPasswordResetTokenRepository,
  InMemoryRiskEventRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  RecordingPasswordRecoveryNotifier,
} from '../../testing/auth-doubles.js';
import { AuthService } from './auth.service.js';
import type { RequestContext } from './ports.js';

const CONTEXT: RequestContext = { userAgent: 'vitest', ipAddress: '203.0.113.7' };
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a whole new passphrase';
const WEAK_PASSWORD = 'short';

interface Harness {
  service: AuthService;
  users: InMemoryUserRepository;
  sessions: InMemorySessionRepository;
  resetTokens: InMemoryPasswordResetTokenRepository;
  riskEvents: InMemoryRiskEventRepository;
  notifier: RecordingPasswordRecoveryNotifier;
  clock: FakeClock;
}

function buildService(overrides: DeepPartial<AppConfig> = {}): Harness {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const resetTokens = new InMemoryPasswordResetTokenRepository();
  const riskEvents = new InMemoryRiskEventRepository();
  const notifier = new RecordingPasswordRecoveryNotifier();
  const clock = new FakeClock();
  const config = new AppConfigService(testAppConfig(overrides));

  const service = new AuthService(
    users,
    sessions,
    resetTokens,
    riskEvents,
    notifier,
    new AccessTokenService(config),
    config,
    clock,
  );

  return { service, users, sessions, resetTokens, riskEvents, notifier, clock };
}

/** Error code a call is expected to be refused with. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error: unknown) {
    if (error instanceof ApiException) return error.code;

    throw error;
  }

  throw new Error('expected the call to be refused');
}

describe('AuthService.register', () => {
  it('creates an active account and starts a session', async () => {
    const { service, users, sessions } = buildService();

    const response = await service.register(
      { email: 'Person@Example.com', password: PASSWORD },
      CONTEXT,
    );

    expect(response.verificationRequired).toBe(false);
    expect(response.user.email).toBe('person@example.com');
    expect(response.user.status).toBe('ACTIVE');
    expect(response.user.roles).toEqual(['CUSTOMER']);
    expect(response.tokens?.accessToken).toBeTypeOf('string');
    expect(sessions.live()).toHaveLength(1);
    expect(await users.findByEmail('person@example.com')).not.toBeNull();
  });

  it('stores an Argon2id hash and never the plaintext', async () => {
    const { service, users } = buildService();

    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    const stored = await users.findByEmail('person@example.com');

    expect(stored?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it('refuses a duplicate address regardless of casing', async () => {
    const { service } = buildService();

    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    expect(
      await codeOf(() =>
        service.register({ email: 'PERSON@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('refuses a password that does not meet the policy', async () => {
    const { service, users } = buildService();

    expect(
      await codeOf(() => service.register({ email: 'a@b.com', password: WEAK_PASSWORD }, CONTEXT)),
    ).toBe('VALIDATION_FAILED');
    expect(await users.findByEmail('a@b.com')).toBeNull();
  });

  it('reports missing credentials', async () => {
    const { service } = buildService();

    expect(await codeOf(() => service.register({ email: '', password: '' }, CONTEXT))).toBe(
      'CREDENTIALS_INCOMPLETE',
    );
  });
});

describe('AuthService.register with email verification required', () => {
  const harness = () => buildService({ auth: { requireEmailVerification: true } });

  it('creates a pending account and hands out no session', async () => {
    const { service, sessions } = harness();

    const response = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    expect(response.verificationRequired).toBe(true);
    expect(response.tokens).toBeNull();
    expect(response.user.status).toBe('PENDING_VERIFICATION');
    expect(sessions.live()).toHaveLength(0);
  });

  it('refuses to sign in until the address is verified', async () => {
    const { service } = harness();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('EMAIL_NOT_VERIFIED');
  });
});

describe('AuthService.login', () => {
  it('starts a session for valid credentials and stamps the login', async () => {
    const { service, users } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    const response = await service.login(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    expect(response.tokens.tokenType).toBe('Bearer');
    expect(response.tokens.expiresIn).toBeGreaterThan(0);
    expect((await users.findByEmail('person@example.com'))?.lastLoginAt).not.toBeNull();
  });

  it('treats the address case-insensitively', async () => {
    const { service } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    const response = await service.login(
      { email: 'PERSON@EXAMPLE.COM', password: PASSWORD },
      CONTEXT,
    );

    expect(response.user.email).toBe('person@example.com');
  });

  it('refuses a wrong password with the same code as an unknown account', async () => {
    const { service } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: 'wrong password' }, CONTEXT),
      ),
    ).toBe('INVALID_CREDENTIALS');
    expect(
      await codeOf(() =>
        service.login({ email: 'nobody@example.com', password: 'wrong password' }, CONTEXT),
      ),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('counts failures and locks the account at the configured threshold', async () => {
    const { service, users, riskEvents } = buildService({ auth: { loginMaxAttempts: 3 } });
    const registered = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(
        await codeOf(() =>
          service.login({ email: 'person@example.com', password: 'wrong password' }, CONTEXT),
        ),
      ).toBe('INVALID_CREDENTIALS');
    }

    expect((await users.findByEmail('person@example.com'))?.failedLoginAttempts).toBe(2);

    // The third failure reaches the threshold, so even the correct password is
    // refused from here on.
    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: 'wrong password' }, CONTEXT),
      ),
    ).toBe('INVALID_CREDENTIALS');

    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('ACCOUNT_LOCKED');

    expect(riskEvents.events).toContainEqual(
      expect.objectContaining({
        type: 'auth.account_locked',
        severity: 'LOW',
        subjectId: registered.user.id,
      }),
    );
  });

  it('lets the account back in once the lock expires, clearing the counter', async () => {
    const { service, users, clock } = buildService({
      auth: { loginMaxAttempts: 1, loginLockMinutes: 15 },
    });
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: 'wrong password' }, CONTEXT),
      ),
    ).toBe('INVALID_CREDENTIALS');

    clock.advance(16 * 60_000);

    const response = await service.login(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    expect(response.tokens.refreshToken).toBeTypeOf('string');
    expect((await users.findByEmail('person@example.com'))?.failedLoginAttempts).toBe(0);
    expect((await users.findByEmail('person@example.com'))?.lockedUntil).toBeNull();
  });

  it('refuses a disabled account and a suspended account', async () => {
    const { service, users } = buildService();
    const disabled = await service.register(
      { email: 'disabled@example.com', password: PASSWORD },
      CONTEXT,
    );
    const suspended = await service.register(
      { email: 'suspended@example.com', password: PASSWORD },
      CONTEXT,
    );

    users.setStatus(disabled.user.id, 'DISABLED');
    users.setStatus(suspended.user.id, 'SUSPENDED');

    expect(
      await codeOf(() =>
        service.login({ email: 'disabled@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('ACCOUNT_DISABLED');
    expect(
      await codeOf(() =>
        service.login({ email: 'suspended@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('ACCOUNT_SUSPENDED');
  });

  it('upgrades a hash created with weaker parameters', async () => {
    const { service, users } = buildService();
    const weaker = await hashPassword(PASSWORD, {
      memoryKib: TEST_ARGON2_PARAMETERS.memoryKib,
      iterations: 2,
      parallelism: 1,
    });

    users.seed({ email: 'legacy@example.com', passwordHash: weaker });
    await service.login({ email: 'legacy@example.com', password: PASSWORD }, CONTEXT);

    const upgraded = await users.findByEmail('legacy@example.com');

    expect(upgraded?.passwordHash).not.toBe(weaker);
    // The configured cost for tests is a single pass.
    expect(upgraded?.passwordHash).toContain('t=1');
  });

  it('cannot sign in a soft-deleted account', async () => {
    const { service, users } = buildService();
    const registered = await service.register(
      { email: 'gone@example.com', password: PASSWORD },
      CONTEXT,
    );
    users.softDelete(registered.user.id);

    expect(
      await codeOf(() => service.login({ email: 'gone@example.com', password: PASSWORD }, CONTEXT)),
    ).toBe('INVALID_CREDENTIALS');
  });
});

describe('AuthService.refresh', () => {
  it('rotates the token and invalidates the presented one', async () => {
    const { service, sessions } = buildService();
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );
    const presented = login.tokens!.refreshToken;

    const refreshed = await service.refresh(presented, CONTEXT);

    expect(refreshed.tokens.refreshToken).not.toBe(presented);
    expect(refreshed.tokens.accessTokenExpiresAt).toBeTypeOf('string');
    // Rotation keeps exactly one live session.
    expect(sessions.live()).toHaveLength(1);
  });

  it('refuses a replayed rotated token and closes the whole family', async () => {
    const { service, sessions, riskEvents } = buildService();
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );
    const stolen = login.tokens!.refreshToken;

    const attacker = await service.refresh(stolen, CONTEXT);
    await service.refresh(attacker.tokens.refreshToken, CONTEXT);

    expect(await codeOf(() => service.refresh(stolen, CONTEXT))).toBe('REFRESH_TOKEN_REUSED');
    // The stolen replacement is cut off too: the family is gone, not just the
    // token that was replayed.
    expect(await codeOf(() => service.refresh(attacker.tokens.refreshToken, CONTEXT))).toBe(
      'REFRESH_TOKEN_REUSED',
    );
    expect(sessions.live()).toHaveLength(0);
    expect(riskEvents.events).toContainEqual(
      expect.objectContaining({ type: 'auth.refresh_token_reuse', severity: 'HIGH' }),
    );
  });

  it('refuses an unknown token', async () => {
    const { service } = buildService();

    expect(await codeOf(() => service.refresh('dyu_rt_not-a-real-token', CONTEXT))).toBe(
      'TOKEN_INVALID',
    );
  });

  it('refuses an expired session and closes it', async () => {
    const { service, clock } = buildService({ auth: { refreshExpiresIn: '30d' } });
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    clock.advance(31 * 24 * 3_600_000);

    expect(await codeOf(() => service.refresh(login.tokens!.refreshToken, CONTEXT))).toBe(
      'TOKEN_EXPIRED',
    );
  });

  it('refuses a session whose account was disabled after the login', async () => {
    const { service, users } = buildService();
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    users.setStatus(login.user.id, 'DISABLED');

    expect(await codeOf(() => service.refresh(login.tokens!.refreshToken, CONTEXT))).toBe(
      'ACCOUNT_DISABLED',
    );
  });

  it('refuses a session whose account no longer exists', async () => {
    const { service, users } = buildService();
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );
    users.softDelete(login.user.id);

    expect(await codeOf(() => service.refresh(login.tokens!.refreshToken, CONTEXT))).toBe(
      'TOKEN_REVOKED',
    );
  });
});

describe('AuthService.logout', () => {
  it('closes the session and is idempotent', async () => {
    const { service, sessions } = buildService();
    const login = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    await service.logout(login.tokens!.refreshToken);
    await service.logout(login.tokens!.refreshToken);

    expect(sessions.live()).toHaveLength(0);
    expect(await codeOf(() => service.refresh(login.tokens!.refreshToken, CONTEXT))).toBe(
      'TOKEN_REVOKED',
    );
  });

  it('closes every session of the account on request', async () => {
    const { service, sessions } = buildService();
    const first = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );
    const second = await service.login(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    expect(sessions.live()).toHaveLength(2);
    expect(await service.logoutEverywhere(first.user.id)).toBe(2);
    expect(sessions.live()).toHaveLength(0);
    expect(await codeOf(() => service.refresh(second.tokens.refreshToken, CONTEXT))).toBe(
      'TOKEN_REVOKED',
    );
  });
});

describe('AuthService password recovery', () => {
  it('answers the same way for a known and an unknown address', async () => {
    const { service, resetTokens, notifier } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    await service.requestPasswordRecovery('stranger@example.com', '203.0.113.7');

    // Only the real account produced a token, and neither call reported that the
    // address is unknown.
    expect(notifier.delivered).toHaveLength(1);
    expect(resetTokens.liveCount()).toBe(1);
  });

  it('changes the password, revokes every session and refuses to reuse the token', async () => {
    const { service, sessions, resetTokens, notifier } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);
    await service.login({ email: 'person@example.com', password: PASSWORD }, CONTEXT);

    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    const token = notifier.lastToken()!;
    expect(token).toBeTypeOf('string');

    const result = await service.completePasswordRecovery(token, NEW_PASSWORD);

    expect(result.status).toBe('reset');
    expect(sessions.live()).toHaveLength(0);
    expect(resetTokens.liveCount()).toBe(0);
    expect(
      await codeOf(() =>
        service.login({ email: 'person@example.com', password: PASSWORD }, CONTEXT),
      ),
    ).toBe('INVALID_CREDENTIALS');

    const relogin = await service.login(
      { email: 'person@example.com', password: NEW_PASSWORD },
      CONTEXT,
    );
    expect(relogin.tokens.refreshToken).toBeTypeOf('string');
  });

  it('refuses a token that was already used', async () => {
    const { service, notifier } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);
    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    const token = notifier.lastToken()!;

    await service.completePasswordRecovery(token, NEW_PASSWORD);

    expect(
      await codeOf(() => service.completePasswordRecovery(token, 'yet another passphrase')),
    ).toBe('TOKEN_INVALID');
  });

  it('refuses an expired token', async () => {
    const { service, notifier, clock } = buildService({ auth: { passwordResetTtlHours: 1 } });
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);
    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    const token = notifier.lastToken()!;

    clock.advance(2 * 3_600_000);

    expect(await codeOf(() => service.completePasswordRecovery(token, NEW_PASSWORD))).toBe(
      'TOKEN_INVALID',
    );
  });

  it('enforces the password policy on the new password', async () => {
    const { service, notifier } = buildService();
    await service.register({ email: 'person@example.com', password: PASSWORD }, CONTEXT);
    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    const token = notifier.lastToken()!;

    expect(await codeOf(() => service.completePasswordRecovery(token, WEAK_PASSWORD))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('never puts the token anywhere but the delivery channel', async () => {
    const { service, notifier, sessions, users } = buildService();
    const registered = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    await service.requestPasswordRecovery('person@example.com', '203.0.113.7');
    const token = notifier.lastToken()!;

    // The stored token is a hash, so the session table and the account record
    // cannot be turned back into a working reset link.
    expect(JSON.stringify(sessions.live())).not.toContain(token);
    expect(JSON.stringify(await users.findById(registered.user.id))).not.toContain(token);
  });
});

describe('AuthService.verifyEmail', () => {
  it('leaves a pending account pending while verification is required', async () => {
    const { service, users } = buildService({ auth: { requireEmailVerification: true } });
    const registered = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    await service.verifyEmail(registered.user.id);

    const stored = await users.findById(registered.user.id);
    expect(stored?.emailVerifiedAt).not.toBeNull();
    // A verified address is not an approval: the deployment still requires one.
    expect(stored?.status).toBe('PENDING_VERIFICATION');
  });

  it('activates the account when the deployment does not require verification', async () => {
    const { service, users } = buildService({ auth: { requireEmailVerification: false } });
    const registered = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );
    users.setStatus(registered.user.id, 'PENDING_VERIFICATION');

    await service.verifyEmail(registered.user.id);

    expect((await users.findById(registered.user.id))?.status).toBe('ACTIVE');
  });
});

describe('AuthService.currentUser', () => {
  it('reports the account behind a session without its hash', async () => {
    const { service } = buildService();
    const registered = await service.register(
      { email: 'person@example.com', password: PASSWORD },
      CONTEXT,
    );

    const user = await service.currentUser(registered.user.id);

    expect(user.email).toBe('person@example.com');
    expect(JSON.stringify(user)).not.toContain('argon2');
  });

  it('reports a missing account as not found', async () => {
    const { service } = buildService();

    expect(await codeOf(() => service.currentUser('00000000-0000-0000-0000-000000000000'))).toBe(
      'NOT_FOUND',
    );
  });
});
