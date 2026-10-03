# API Rules

Base:

/api/v1

---

# Success

Use predictable JSON responses.

Example:

{
  "data": {}
}

---

# Error

{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable explanation.",
    "details": {},
    "correlationId": "0f6d5b7e-1f4a-4a1f-9a2c-2f2f4f9a1c22"
  }
}

`details` is optional and never contains stack traces, SQL text or provider
payloads. `correlationId` is always present and matches the `X-Request-Id`
response header, so a failure can be reported with a single value (ADR-014).

---

# Correlation

Every response carries `X-Request-Id`.

A client supplied value is reused only when it is safe (printable, bounded
length); otherwise the server generates a UUID.

---

# Pagination

Example:

GET /api/v1/merchants?limit=20&cursor=abc

Response:

{
  "data": [],
  "pagination": {
    "nextCursor": null
  }
}

---

# Authentication

Authorization:

Bearer <access_token>

- The access token is a signed JWT. The refresh token is an **opaque string**
  sent in the JSON body of `POST /auth/refresh`, never in a header and never as a
  bearer token.
- Tokens and passwords must not be placed in a query string: query strings end
  up in access logs and proxy logs.
- `POST /auth/logout` is public and idempotent, because a client that lost its
  session must still be able to close it.
- Every other route requires a token by default. A route is public only when it
  carries `@Public()`; there is no allowlist to forget.

## Authentication status codes

| Situation | Status | `code` |
| --------- | ------ | ------ |
| No `Authorization` header, or a scheme other than bearer | `401` | `UNAUTHENTICATED` |
| Bearer token this deployment did not sign, or malformed claims | `401` | `TOKEN_INVALID` |
| Expired access token | `401` | `TOKEN_EXPIRED` |
| Refresh token already rotated (replay) | `401` | `REFRESH_TOKEN_REUSED` |
| A refresh token whose family was revoked by that replay | `401` | `TOKEN_REVOKED` |
| Unknown or malformed refresh/reset token | `401` | `TOKEN_INVALID` |
| Wrong password **or** unknown account | `401` | `INVALID_CREDENTIALS` |
| Refresh or reset body missing `token` | `400` | `VALIDATION_FAILED` |
| Too many failed attempts | `429` | `ACCOUNT_LOCKED` |
| Address already registered | `409` | `EMAIL_ALREADY_REGISTERED` |
| Rate limit exceeded | `429` | `RATE_LIMITED` |
| Verification required and not done | `403` | `EMAIL_NOT_VERIFIED` |
| Account suspended or disabled | `403` | `ACCOUNT_SUSPENDED` / `ACCOUNT_DISABLED` |

A wrong password and an unknown account must be indistinguishable to the client;
so must password recovery for a known and an unknown address.

A replayed refresh token is the one case that is reported as such
(`REFRESH_TOKEN_REUSED`): the caller already holds a credential, so telling them
that it was stolen is what lets a client invalidate its own session. Tokens in
that family revoked as a consequence answer `TOKEN_REVOKED` instead of a second
reuse, which is what tells the legitimate client that the family is gone. An
unknown token answers `TOKEN_INVALID` and explains nothing. See `SECURITY.md`
"Authentication".

---

# Dates

ISO 8601.

UTC from backend.

---

# Money

Return monetary fields consistently.

Never return binary floating point approximations.

---

# Endpoint Security

Every endpoint must explicitly determine:

public
authenticated
role protected
resource ownership protected

## How it is enforced

The default is **authenticated**. `JwtAuthGuard` is registered globally and a
route opts out with `@Public()`. A route therefore cannot be exposed by omission.

On top of authentication, a route declares what it needs:

- `@RateLimit(...)` - the budget, by `ip`, `email` or `user` scope;
- `@Roles(...)` - the roles the caller must hold (`RolesGuard`);
- `@Permissions(...)` - the RBAC permission the caller must have, resolved from
  the permission matrix in `packages/auth` (`PermissionsGuard`).

## Public routes as of PHASE 03

| Route | Why it is public |
| ----- | ---------------- |
| `GET /api/v1/health/live` | liveness must answer when nothing else does |
| `GET /api/v1/health/ready` | a probe cannot hold a token |
| `POST /api/v1/auth/register` | the account does not exist yet |
| `POST /api/v1/auth/login` | the credentials are the credential |
| `POST /api/v1/auth/refresh` | the refresh token is the credential |
| `POST /api/v1/auth/logout` | a client without a valid session must still be able to close it |
| `POST /api/v1/auth/password/forgot` | the account may not exist |
| `POST /api/v1/auth/password/reset` | the reset token is the credential |
| `POST /api/v1/auth/verify-email` | the verification code is the credential |

Anything not on this list requires a bearer token.

`POST /auth/verify-email` answers `200` with `{ verified, canSignIn }`. Those are
two facts, not one: a deployment may hold a proven address for approval, and a
client that is told only `verified: true` would then present a sign-in form that
cannot work. A code that is unknown, expired, already used or issued under a
different purpose answers `401 TOKEN_INVALID` - one answer for all four, so the
response reveals nothing about which.

---

# Documentation

OpenAPI document: `/api/docs` (Swagger UI) and `/api/docs-json`.

Paths already include the `/api/v1` prefix and the document declares no server
host, so it resolves against whatever origin serves it (reverse proxies and
multi-domain deployments must not be baked into the specification).