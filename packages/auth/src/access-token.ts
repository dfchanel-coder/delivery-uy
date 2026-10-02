import { randomUUID } from 'node:crypto';
import { SignJWT, decodeJwt, errors as joseErrors, jwtVerify } from 'jose';

/**
 * Access token issuing and verification (ADR-002, SECURITY.md).
 *
 * Only HS256 is accepted. The algorithm is pinned on both sides, so a token
 * that asks for `alg: none` or for an asymmetric algorithm with the public key
 * as the HMAC secret is rejected before any signature work happens. Refresh
 * tokens are *not* JWTs: they are opaque random values whose SHA-256 hash is
 * stored (SECURITY.md "Password and Token Parameters"), so revoking a session
 * takes effect immediately instead of waiting for a JWT to expire.
 */

export const ACCESS_TOKEN_TYPE = 'access';

/** Algorithm accepted in the JOSE header. Nothing else is ever verified. */
const ALGORITHM = 'HS256' as const;

/** Clock skew tolerated when checking `iat` and `exp`. */
const CLOCK_TOLERANCE_MS = 5_000;

/**
 * Reference date handed to the library so it skips its own expiry check.
 *
 * It is only ever compared against `exp` values of real tokens (always far in
 * the future relative to 1970), so it disables the check without weakening
 * signature, algorithm, issuer or audience validation.
 */
const EPOCH = new Date(0);

export interface AccessTokenConfig {
  /** HMAC secret from `JWT_ACCESS_SECRET`. */
  readonly secret: string;
  readonly issuer: string;
  readonly audience: string;
  /** Duration string such as `15m`. */
  readonly expiresIn: string;
}

export interface AccessTokenClaims {
  readonly subject: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Why a token was refused.
 *
 * Kept as a closed set so the HTTP layer can translate it into the documented
 * error code without inspecting library-specific messages.
 */
export type AccessTokenRejection =
  | 'malformed'
  | 'expired'
  | 'not_yet_valid'
  | 'bad_signature'
  | 'algorithm_not_allowed'
  | 'claim_validation_failed'
  | 'wrong_token_type';

export class AccessTokenError extends Error {
  public constructor(
    public readonly rejection: AccessTokenRejection,
    message: string,
  ) {
    super(message);
    this.name = 'AccessTokenError';
  }
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface AccessTokenIssuer {
  issue(input: {
    readonly subject: string;
    readonly sessionId: string;
    readonly roles: readonly string[];
  }): Promise<IssuedAccessToken>;
  verify(token: string): Promise<AccessTokenClaims>;
}

const MINIMUM_SECRET_LENGTH = 32;

function secretKey(config: AccessTokenConfig): Uint8Array {
  if (typeof config.secret !== 'string' || config.secret.length < MINIMUM_SECRET_LENGTH) {
    throw new RangeError(
      `access token secret must be at least ${MINIMUM_SECRET_LENGTH} characters`,
    );
  }
  if (typeof config.issuer !== 'string' || config.issuer.length === 0) {
    throw new TypeError('access token issuer is required');
  }
  if (typeof config.audience !== 'string' || config.audience.length === 0) {
    throw new TypeError('access token audience is required');
  }
  if (typeof config.expiresIn !== 'string' || config.expiresIn.length === 0) {
    throw new TypeError('access token expiresIn is required');
  }

  return new TextEncoder().encode(config.secret);
}

/**
 * Classifies a cryptographic verification failure.
 *
 * Claim validation is done by this module rather than delegated, so an expired
 * token stays distinguishable from a token with an invalid claim: clients need
 * that distinction to decide between refreshing and discarding.
 */
function mapJoseError(error: unknown): AccessTokenError {
  if (!(error instanceof joseErrors.JOSEError)) {
    return new AccessTokenError('malformed', 'access token is not a valid JWT');
  }

  switch (error.code) {
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
      return new AccessTokenError('bad_signature', 'access token signature is invalid');
    case 'ERR_JOSE_ALG_NOT_ALLOWED':
      return new AccessTokenError('algorithm_not_allowed', 'access token algorithm is not allowed');
    case 'ERR_JWT_INVALID':
      return new AccessTokenError('malformed', 'access token is not a valid JWT');
    default:
      return new AccessTokenError('malformed', 'access token could not be verified');
  }
}

function readRoles(payload: Record<string, unknown>): readonly string[] {
  const roles = payload['roles'];

  if (!Array.isArray(roles)) {
    throw new AccessTokenError(
      'claim_validation_failed',
      'access token is missing its roles claim',
    );
  }

  const invalid = roles.filter((role): role is unknown => typeof role !== 'string');

  if (invalid.length > 0) {
    throw new AccessTokenError(
      'claim_validation_failed',
      'access token has a malformed roles claim',
    );
  }

  return roles as readonly string[];
}

function readTimestamp(value: unknown, claim: string): Date {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AccessTokenError(
      'claim_validation_failed',
      `access token is missing its ${claim} claim`,
    );
  }

  return new Date(value * 1000);
}

export function createAccessTokenIssuer(config: AccessTokenConfig): AccessTokenIssuer {
  const key = secretKey(config);

  return {
    async issue({ subject, sessionId, roles }) {
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new TypeError('access token subject is required');
      }
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new TypeError('access token sessionId is required');
      }

      const token = await new SignJWT({ roles: [...roles], typ: ACCESS_TOKEN_TYPE, sid: sessionId })
        .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
        .setSubject(subject)
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(config.expiresIn)
        .sign(key);

      // The claims are read back from the token we just produced instead of
      // recomputed locally, so the returned dates can never disagree with the
      // ones a client will see.
      const payload = decodeJwt(token);
      const issuedAt = readTimestamp(payload.iat, 'iat');
      const expiresAt = readTimestamp(payload.exp, 'exp');

      return { token, issuedAt, expiresAt };
    },

    async verify(token) {
      if (typeof token !== 'string' || token.length === 0) {
        throw new AccessTokenError('malformed', 'access token is missing');
      }

      let payload: Record<string, unknown>;

      try {
        // Signature, algorithm, issuer and audience are verified by the library.
        // Expiry is checked by this module instead, so that an expired token is
        // reported as `expired` rather than as a generic claim failure: clients
        // refresh on the first and discard on the second.
        const verified = await jwtVerify(token, key, {
          algorithms: [ALGORITHM],
          issuer: config.issuer,
          audience: config.audience,
          currentDate: EPOCH,
        });
        // `JWTPayload` already is a `Record<string, unknown>` with typed extras.
        payload = verified.payload;
      } catch (error: unknown) {
        throw mapJoseError(error);
      }

      if (typeof payload['jti'] !== 'string' || payload['jti'].length === 0) {
        throw new AccessTokenError(
          'claim_validation_failed',
          'access token is missing its id claim',
        );
      }

      if (payload['typ'] !== ACCESS_TOKEN_TYPE) {
        throw new AccessTokenError('wrong_token_type', 'token is not an access token');
      }

      const subject = payload['sub'];
      if (typeof subject !== 'string' || subject.length === 0) {
        throw new AccessTokenError(
          'claim_validation_failed',
          'access token is missing its subject',
        );
      }

      const sessionId = payload['sid'];
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new AccessTokenError(
          'claim_validation_failed',
          'access token is missing its session',
        );
      }

      const issuedAt = readTimestamp(payload['iat'], 'iat');
      const expiresAt = readTimestamp(payload['exp'], 'exp');

      // 5 seconds of tolerance absorbs clock skew between the API and the
      // client without meaningfully extending token lifetime.
      if (expiresAt.getTime() + CLOCK_TOLERANCE_MS <= Date.now()) {
        throw new AccessTokenError('expired', 'access token has expired');
      }
      if (issuedAt.getTime() - CLOCK_TOLERANCE_MS > Date.now()) {
        throw new AccessTokenError('not_yet_valid', 'access token is not valid yet');
      }

      return {
        subject,
        sessionId,
        roles: readRoles(payload),
        issuedAt,
        expiresAt,
      };
    },
  };
}
