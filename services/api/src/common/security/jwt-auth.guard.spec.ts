import { describe, expect, it, vi } from 'vitest';
import {
  AccessTokenError,
  type AccessTokenClaims,
  type AccessTokenRejection,
  type AuthenticatedPrincipal,
} from '@deliveryuy/auth';
import { IS_PUBLIC_KEY } from './endpoint-security.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

/**
 * The authentication guard, on its own terms.
 *
 * Registered globally and in front of every non-public request, so this is the
 * single place where "who is calling?" is decided. The auth e2e suite observes
 * real 401s through the whole stack, which proves the happy refusals; what it
 * cannot show is the branch below the API surface, where a failure inside the
 * verifier is turned into a response. That branch is the dangerous one: if a
 * server fault were reported as a bad token, every client would treat a valid
 * session as dead and sign the user out.
 *
 * What these hold:
 *
 * - a public route never reaches the token service at all;
 * - a malformed header is refused without asking the verifier anything;
 * - `TOKEN_EXPIRED` is the only rejection a client is told to recover from, and
 *   every other one is `TOKEN_INVALID`;
 * - a fault that is not a token rejection becomes a 500 whose message says
 *   nothing about the token, while the original error goes to the log;
 * - nothing but a principal is attached to the request.
 */

/** Claims as the issuer would produce them for a signed-in user. */
function claimsFor(roles: readonly string[] = ['CUSTOMER']): AccessTokenClaims {
  return {
    subject: '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
    sessionId: '5c1d4a90-2b7e-4f3a-9c81-0d2e6f4a7b33',
    roles,
    issuedAt: new Date('2026-01-05T12:00:00.000Z'),
    expiresAt: new Date('2026-01-05T12:15:00.000Z'),
  };
}

/** Records whether the verifier was consulted, so "refused early" is provable. */
function verifierAnswering(answer: AccessTokenClaims | Error): {
  verify: ReturnType<typeof vi.fn>;
  calls: () => number;
} {
  const calls: number[] = [];

  const verify = vi.fn(async (): Promise<AccessTokenClaims> => {
    calls.push(1);

    if (answer instanceof Error) throw answer;

    return answer;
  });

  return { verify, calls: () => calls.length };
}

function guardFor(metadata: unknown, answer: AccessTokenClaims | Error = claimsFor()) {
  const reflector = { getAllAndOverride: vi.fn(() => metadata) };
  const tokens = verifierAnswering(answer);

  const guard = new JwtAuthGuard(reflector as never, { verify: tokens.verify } as never);

  return { guard, ...tokens };
}

/** A request object shaped like the express one the guard reads. */
interface FakeRequest {
  headers: Record<string, string>;
  principal?: AuthenticatedPrincipal;
}

function requestFor(authorization?: string): FakeRequest {
  return { headers: authorization === undefined ? {} : { authorization } };
}

function contextFor(request: FakeRequest) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

type Guard = { canActivate: (context: never) => Promise<boolean> };

async function thrownBy(guard: Guard, context: unknown): Promise<unknown> {
  try {
    await guard.canActivate(context as never);
  } catch (error: unknown) {
    return error;
  }

  throw new Error('expected the guard to refuse, and it allowed the request');
}

describe('JwtAuthGuard', () => {
  it('lets a public route through without consulting the verifier', async () => {
    // Reaching the verifier for a public route would mean a login or health
    // probe depends on JWT configuration, and that a public route could be
    // authenticated by accident.
    const { guard, calls } = guardFor(true);

    await expect(guard.canActivate(contextFor(requestFor()) as never)).resolves.toBe(true);

    expect(calls()).toBe(0);
  });

  it('reads the public marker from the route', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => true) };

    await new JwtAuthGuard(reflector as never, { verify: vi.fn() } as never).canActivate(
      contextFor(requestFor()) as never,
    );

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
  });

  it('attaches no principal to a public route', async () => {
    // The reason `@Public()` combined with `@Permissions()` is a server fault and
    // not a working configuration: authentication was skipped, so there is no
    // principal for the next guard to read. Pinned here where the cause lives.
    const request = requestFor();
    const { guard } = guardFor(true);

    await guard.canActivate(contextFor(request) as never);

    expect(request.principal).toBeUndefined();
  });

  it.each([
    ['no Authorization header', undefined],
    ['an unrelated scheme', 'Basic dXNlcjpwYXNz'],
    ['a bearer token with no value', 'Bearer'],
    ['a bearer token that is only spaces', 'Bearer    '],
    ['a scheme with no token', 'Bearer '],
  ])('refuses %s without consulting the verifier', async (_label, authorization) => {
    const { guard, calls } = guardFor(undefined);

    const error = await thrownBy(guard, contextFor(requestFor(authorization)));

    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(calls()).toBe(0);
  });

  it('refuses an extra space between the scheme and the token', async () => {
    // RFC 7235 allows one or more spaces after the scheme, so `Bearer  <token>`
    // is legal and some clients emit it. Splitting on a single space puts an
    // empty string where the token should be, and the request is refused.
    // Fail-closed, so not a security gap, but an interop limit worth having on
    // record rather than discovering from a client's bug report.
    const { guard, calls } = guardFor(undefined);

    const error = await thrownBy(guard, contextFor(requestFor('Bearer  a.b.c')));

    expect(error).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(calls()).toBe(0);
  });

  it.each(['bearer', 'BEARER', 'BeArEr'])('accepts the scheme in any case: %s', async (scheme) => {
    // RFC 7235 makes the scheme case-insensitive; rejecting `Bearer` spelled
    // differently would log out clients for a formatting detail.
    const { guard } = guardFor(undefined);

    await expect(
      guard.canActivate(contextFor(requestFor(`${scheme} a.b.c`)) as never),
    ).resolves.toBe(true);
  });

  it('attaches the principal the claims describe', async () => {
    const request = requestFor('Bearer a.b.c');
    const { guard } = guardFor(undefined, claimsFor(['MERCHANT']));

    await expect(guard.canActivate(contextFor(request) as never)).resolves.toBe(true);

    expect(request.principal).toMatchObject({
      userId: '3f0b3f2c-6f1a-4a0d-9f6a-3a1c9a0d2b11',
      sessionId: '5c1d4a90-2b7e-4f3a-9c81-0d2e6f4a7b33',
      roles: ['MERCHANT'],
    });
  });

  it('adds nothing to the request but the principal', async () => {
    // Controllers read the principal and nothing else, so a token cannot be
    // logged by accident or passed into a template, an email or a query. The
    // request starts carrying only headers, so any other key the guard attached
    // would show up here.
    const request = requestFor('Bearer a.secret-token-value');
    const { guard } = guardFor(undefined);

    await guard.canActivate(contextFor(request) as never);

    expect(Object.keys(request)).toEqual(['headers', 'principal']);
    expect(JSON.stringify(request.principal)).not.toContain('a.secret-token-value');
  });

  it('sends the token to the verifier and keeps it nowhere else', async () => {
    // The one legitimate use of the raw token: the single call that checks its
    // signature.
    const request = requestFor('Bearer a.secret-token-value');
    const { guard, verify } = guardFor(undefined);

    await guard.canActivate(contextFor(request) as never);

    expect(verify).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledWith('a.secret-token-value');
  });

  it('drops role names the platform does not know', async () => {
    // The guard is where a forged claim first becomes usable state, so the
    // filtering is asserted at the boundary rather than only in the policy unit.
    const request = requestFor('Bearer a.b.c');
    const { guard } = guardFor(undefined, claimsFor(['CUSTOMER', 'ROOT']));

    await guard.canActivate(contextFor(request) as never);

    expect((request.principal as { roles: readonly string[] }).roles).toEqual(['CUSTOMER']);
  });

  it('tells the client to refresh when the token has expired', async () => {
    // The only rejection a client can act on. Everything else means the token is
    // gone and the session must be discarded, so collapsing the two would make
    // clients keep retrying a credential that will never work.
    const { guard } = guardFor(undefined, new AccessTokenError('expired', 'jwt expired'));

    expect(await thrownBy(guard, contextFor(requestFor('Bearer a.b.c')))).toMatchObject({
      code: 'TOKEN_EXPIRED',
      statusCode: 401,
      details: { reason: 'expired' },
    });
  });

  const otherRejections: readonly AccessTokenRejection[] = [
    'malformed',
    'not_yet_valid',
    'bad_signature',
    'algorithm_not_allowed',
    'claim_validation_failed',
    'wrong_token_type',
  ];

  it.each(otherRejections)('treats %s as an invalid token', async (rejection) => {
    const { guard } = guardFor(
      undefined,
      new AccessTokenError(rejection, `rejected: ${rejection}`),
    );

    expect(await thrownBy(guard, contextFor(requestFor('Bearer a.b.c')))).toMatchObject({
      code: 'TOKEN_INVALID',
      statusCode: 401,
      // The reason is preserved so support can tell a clock-skew `not_yet_valid`
      // from an attack, without the client having to parse the message.
      details: { reason: rejection },
    });
  });

  it('reports a fault in the verifier as a server error, not a bad token', async () => {
    // The branch with no other coverage anywhere. If a bug inside token
    // verification answered 401, every client would read it as "your session is
    // over", discard a perfectly good refresh token, and sign the user out -
    // turning a server fault into an outage of a different, invisible kind.
    const { guard } = guardFor(undefined, new TypeError('secret.rotate is not a function'));

    expect(await thrownBy(guard, contextFor(requestFor('Bearer a.b.c')))).toMatchObject({
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });

  it('does not repeat the underlying failure to the client', async () => {
    const { guard } = guardFor(undefined, new TypeError('secret.rotate is not a function'));

    const error = (await thrownBy(guard, contextFor(requestFor('Bearer a.b.c')))) as {
      message: string;
    };

    // The original message goes to the log, where the correlation id can find it.
    expect(error.message).not.toContain('secret.rotate');
    expect(error.message).toContain('correlation id');
  });

  it('does not attach a principal when verification fails', async () => {
    // A principal left behind by a previous attempt, or a partially populated
    // one, would be read by the next guard in the chain and treated as
    // authenticated.
    const request = requestFor('Bearer a.b.c');
    const { guard } = guardFor(undefined, new AccessTokenError('bad_signature', 'bad signature'));

    await thrownBy(guard, contextFor(request));

    expect(request.principal).toBeUndefined();
  });
});
