import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  ACCESS_TOKEN_TYPE,
  AccessTokenError,
  type AccessTokenConfig,
  createAccessTokenIssuer,
} from './access-token.js';

const config: AccessTokenConfig = {
  secret: 'test-access-secret-0123456789abcdef0123456789',
  issuer: 'deliveryuy-test',
  audience: 'deliveryuy-clients',
  expiresIn: '15m',
};

const issuer = createAccessTokenIssuer(config);
const key = new TextEncoder().encode(config.secret);

function input(overrides: Partial<{ subject: string; sessionId: string; roles: string[] }> = {}) {
  return {
    subject: overrides.subject ?? '11111111-1111-4111-8111-111111111111',
    sessionId: overrides.sessionId ?? '22222222-2222-4222-8222-222222222222',
    roles: overrides.roles ?? ['CUSTOMER'],
  };
}

describe('access token issuing', () => {
  it('round-trips subject, session and roles', async () => {
    const issued = await issuer.issue(input({ roles: ['CUSTOMER', 'MERCHANT'] }));
    const claims = await issuer.verify(issued.token);

    expect(claims.subject).toBe(input().subject);
    expect(claims.sessionId).toBe(input().sessionId);
    expect(claims.roles).toEqual(['CUSTOMER', 'MERCHANT']);
  });

  it('returns an expiry consistent with the token contents', async () => {
    const issued = await issuer.issue(input());
    const claims = await issuer.verify(issued.token);

    expect(issued.expiresAt.getTime()).toBe(claims.expiresAt.getTime());
    expect(issued.expiresAt.getTime()).toBeGreaterThan(issued.issuedAt.getTime());
  });

  it('honours the configured lifetime', async () => {
    const shortLived = createAccessTokenIssuer({ ...config, expiresIn: '30s' });
    const issued = await shortLived.issue(input());
    const lifetimeSeconds = (issued.expiresAt.getTime() - issued.issuedAt.getTime()) / 1000;

    expect(lifetimeSeconds).toBeGreaterThan(25);
    expect(lifetimeSeconds).toBeLessThanOrEqual(31);
  });

  it('gives every token a unique id', async () => {
    const first = await issuer.issue(input());
    const second = await issuer.issue(input());

    expect(first.token).not.toBe(second.token);
  });

  it('refuses to mint a token without a subject or session', async () => {
    await expect(issuer.issue(input({ subject: '' }))).rejects.toThrow(TypeError);
    await expect(issuer.issue(input({ sessionId: '' }))).rejects.toThrow(TypeError);
  });

  it('refuses a short secret at construction time', () => {
    expect(() => createAccessTokenIssuer({ ...config, secret: 'too-short' })).toThrow(RangeError);
    expect(() => createAccessTokenIssuer({ ...config, issuer: '' })).toThrow(TypeError);
    expect(() => createAccessTokenIssuer({ ...config, audience: '' })).toThrow(TypeError);
    expect(() => createAccessTokenIssuer({ ...config, expiresIn: '' })).toThrow(TypeError);
  });
});

describe('access token verification', () => {
  it('rejects a token signed with another secret', async () => {
    const other = createAccessTokenIssuer({
      ...config,
      secret: 'a-completely-different-secret-value-32',
    });
    const issued = await other.issue(input());

    await expect(issuer.verify(issued.token)).rejects.toMatchObject({
      rejection: 'bad_signature',
    });
  });

  it('rejects an unsigned token (alg: none)', async () => {
    // The classic JWT vulnerability: a token declaring alg "none" must never be
    // accepted. The header is base64url of {"alg":"none","typ":"JWT"}.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: input().subject,
        sid: input().sessionId,
        roles: ['CUSTOMER'],
        typ: ACCESS_TOKEN_TYPE,
        exp: Math.floor(Date.now() / 1000) + 900,
        iat: Math.floor(Date.now() / 1000),
      }),
    ).toString('base64url');
    const unsigned = `${header}.${payload}.`;

    await expect(issuer.verify(unsigned)).rejects.toBeInstanceOf(AccessTokenError);
  });

  it('rejects a token with a missing or malformed payload', async () => {
    await expect(issuer.verify('')).rejects.toMatchObject({ rejection: 'malformed' });
    await expect(issuer.verify('not.a.jwt')).rejects.toMatchObject({ rejection: 'malformed' });
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({
      roles: ['CUSTOMER'],
      typ: ACCESS_TOKEN_TYPE,
      sid: input().sessionId,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input().subject)
      .setJti('test-token-id')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key);

    await expect(issuer.verify(expired)).rejects.toMatchObject({ rejection: 'expired' });
  });

  it('rejects a token from another issuer or audience', async () => {
    const foreignIssuer = await new SignJWT({ roles: ['CUSTOMER'], typ: ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input().subject)
      .setJti('test-token-id')
      .setIssuer('someone-else')
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);

    const foreignAudience = await new SignJWT({ roles: ['CUSTOMER'], typ: ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input().subject)
      .setJti('test-token-id')
      .setIssuer(config.issuer)
      .setAudience('another-client')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);

    await expect(issuer.verify(foreignIssuer)).rejects.toBeInstanceOf(AccessTokenError);
    await expect(issuer.verify(foreignAudience)).rejects.toBeInstanceOf(AccessTokenError);
  });

  it('rejects a token that is not an access token', async () => {
    // Guards against a refresh token or any future token type being replayed as
    // an access token.
    const wrongType = await new SignJWT({ roles: ['CUSTOMER'], typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input().subject)
      .setJti('test-token-id')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);

    await expect(issuer.verify(wrongType)).rejects.toMatchObject({
      rejection: 'wrong_token_type',
    });
  });

  it('rejects a token whose roles claim is not an array of strings', async () => {
    const badRoles = await new SignJWT({ roles: 'CUSTOMER', typ: ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(input().subject)
      .setJti('test-token-id')
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);

    await expect(issuer.verify(badRoles)).rejects.toMatchObject({
      rejection: 'claim_validation_failed',
    });
  });
});
