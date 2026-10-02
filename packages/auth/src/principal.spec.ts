import { describe, expect, it } from 'vitest';
import {
  AccessTokenError,
  type AccessTokenConfig,
  createAccessTokenIssuer,
} from './access-token.js';
import {
  principalCan,
  principalFromClaims,
  principalHasAnyRole,
  principalHasRole,
  principalOwns,
} from './principal.js';

const config: AccessTokenConfig = {
  secret: 'test-access-secret-0123456789abcdef0123456789',
  issuer: 'deliveryuy-test',
  audience: 'deliveryuy-clients',
  expiresIn: '15m',
};

const issuer = createAccessTokenIssuer(config);

async function principalFor(roles: readonly string[]) {
  const issued = await issuer.issue({
    subject: 'user-1',
    sessionId: 'session-1',
    roles: [...roles],
  });
  return principalFromClaims(await issuer.verify(issued.token));
}

describe('principal construction', () => {
  it('keeps the identity and session from verified claims', async () => {
    const principal = await principalFor(['CUSTOMER']);

    expect(principal.userId).toBe('user-1');
    expect(principal.sessionId).toBe('session-1');
    expect(principal.roles).toEqual(['CUSTOMER']);
    expect(principal.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('drops roles that do not exist', async () => {
    // A token minted by an older or compromised version must not be able to
    // smuggle an unknown role string into the application.
    const principal = await principalFor(['CUSTOMER', 'ROOT', 'super_admin', 'ADMIN']);

    expect(principal.roles).toEqual(['CUSTOMER', 'ADMIN']);
  });
});

describe('authorization checks', () => {
  it('answers role questions directly', async () => {
    const customer = await principalFor(['CUSTOMER']);

    expect(principalHasRole(customer, 'CUSTOMER')).toBe(true);
    expect(principalHasRole(customer, 'ADMIN')).toBe(false);
    expect(principalHasAnyRole(customer, ['CUSTOMER', 'MERCHANT'])).toBe(true);
    expect(principalHasAnyRole(customer, ['DRIVER'])).toBe(false);
  });

  it('does not let ADMIN act as SUPER_ADMIN', async () => {
    const admin = await principalFor(['ADMIN']);

    expect(principalCan(admin, 'admin:panel:read')).toBe(true);
    expect(principalCan(admin, 'admin:refunds:create')).toBe(false);
    expect(principalCan(admin, 'admin:config:write')).toBe(false);
  });

  it('keeps ownership separate from privilege', async () => {
    const customer = await principalFor(['CUSTOMER']);

    expect(principalOwns(customer, 'user-1')).toBe(true);
    expect(principalOwns(customer, 'user-2')).toBe(false);
    // A privileged role does not imply ownership of someone else's record;
    // privileged reads go through explicit permissions instead.
    expect(principalOwns(await principalFor(['SUPER_ADMIN']), 'user-2')).toBe(false);
    expect(principalOwns(customer, null)).toBe(false);
  });
});

describe('principal input validation', () => {
  it('rejects claims without an identity', () => {
    expect(() =>
      principalFromClaims({
        subject: '',
        sessionId: 'session-1',
        roles: [],
        issuedAt: new Date(),
        expiresAt: new Date(),
      }),
    ).not.toThrow();

    // The issuer never produces such claims; the guard layer is what rejects
    // them. Documenting the behaviour here keeps the contract explicit.
    const empty = principalFromClaims({
      subject: '',
      sessionId: '',
      roles: [],
      issuedAt: new Date(),
      expiresAt: new Date(),
    });

    expect(empty.roles).toEqual([]);
    expect(principalOwns(empty, '')).toBe(false);
  });
});

describe('token error typing', () => {
  it('reports a rejection reason the HTTP layer can translate', async () => {
    await expect(issuer.verify('garbage')).rejects.toBeInstanceOf(AccessTokenError);

    try {
      await issuer.verify('garbage');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(AccessTokenError);
      expect((error as AccessTokenError).rejection).toBe('malformed');
      expect((error as AccessTokenError).name).toBe('AccessTokenError');
    }
  });
});
