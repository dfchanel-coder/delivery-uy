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
    "nextCursor": null,
    "hasMore": false
  }
}

`hasMore` answers "is there another page?" without implying the client already
holds `nextCursor`; `nextCursor` is `null` exactly when `hasMore` is `false`. The
cursor is opaque and is passed back verbatim as `cursor`; a cursor the server did
not issue is `400 VALIDATION_FAILED` rather than a silent restart from the first
page.

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

`POST /auth/password/forgot` answers `202` with `{ status: 'accepted' }` whether
or not the address is registered, so **the acknowledgement is not a delivery
receipt**. Two things are unknowable to a client at that moment: whether an
account exists, and whether the configured notification provider delivered
anything. A client that renders it as "we sent you a message" would therefore be
stating something the endpoint never asserted, and for an unregistered address it
would also become the account enumerator the identical answer exists to prevent.
`POST /auth/password/reset` returns **no credentials**: a reset revokes every
session precisely because it exists for the case where the old password may be
known to someone else, so a client must send the person back to sign in rather
than treat the call as a way in.

## Admin surface as of PHASE 04

`AdminModule` is the first set of routes that are **not** public and require a
permission rather than mere authentication. Each one declares exactly one
`@Permissions(...)`, resolved from the matrix in `packages/auth`:

| Route | Permission | Roles that hold it |
| ----- | ---------- | ------------------ |
| `GET /api/v1/admin/panel` | `admin:panel:read` | `ADMIN`, `SUPER_ADMIN`, `SUPPORT`, `FINANCE` |
| `GET /api/v1/admin/feature-flags` | `admin:panel:read` | same as panel |
| `GET /api/v1/admin/audit-logs` | `admin:audit:read` | `SUPER_ADMIN` |
| `GET /api/v1/admin/risk-events` | `admin:risk-events:read` | `ADMIN`, `SUPER_ADMIN` |
| `PATCH /api/v1/admin/feature-flags/:key` | `admin:feature-flags:write` | `SUPER_ADMIN` |

`GET /admin/audit-logs` and `GET /admin/risk-events` are paginated; the cursor is
opaque and invalid input answers `400 VALIDATION_FAILED`. `PATCH` answers `404
NOT_FOUND` for a key that does not exist: a toggle never creates a flag, so a
typo cannot define platform behaviour.

The write endpoint writes an `audit_logs` row naming the actor, the role the
token carried, both sides of the change and the request correlation id. No
authorization decision is ever taken from the request body or query string
(SECURITY.md "Authorization").

## Admin users API as of PHASE 04

`UsersModule` is the second surface that requires a permission, and it owns the
user-management routes the phase is named after:

| Route | Permission | Roles that hold it |
| ----- | ---------- | ------------------ |
| `GET /api/v1/users` | `admin:users:read` | `ADMIN`, `SUPER_ADMIN` |
| `GET /api/v1/users/:id` | `admin:users:read` | `ADMIN`, `SUPER_ADMIN` |
| `PATCH /api/v1/users/:id/status` | `admin:users:manage` | `SUPER_ADMIN` |
| `PATCH /api/v1/users/:id/roles` | `admin:users:manage` | `SUPER_ADMIN` |

`GET /users` is paginated (`page`/`limit`) and `GET /users/:id` answers `404
NOT_FOUND` for an unknown id. The two `PATCH` routes answer `400
VALIDATION_FAILED` for a body the DTO does not accept: the DTOs are
`class-validator`, so the global `ValidationPipe` (`whitelist` +
`forbidNonWhitelisted`) rejects unknown fields instead of ignoring them. The
service refuses to suspend the last active `SUPER_ADMIN`, or to remove that role
from it, so the platform cannot be locked out of its own top role.

## Merchant and geo surface as of PHASE 05

`GeoModule` exposes the city list a client needs before it can register a
business; `MerchantsModule` owns the merchant-facing routes and the
administrative review, gated by `admin:merchants:review` (the same pattern as
`UsersModule`: the resource module owns its admin routes).

| Route | Permission | Notes |
| ----- | ---------- | ----- |
| `GET /api/v1/geo/cities` | none (authenticated) | enabled cities, alphabetical |
| `POST /api/v1/merchants` | none (authenticated) | rate-limited per user; `201 PENDING_REVIEW` |
| `GET /api/v1/merchants/mine` | `merchant:profile:read` | the caller's businesses, newest first |
| `GET /api/v1/merchants/:id` | `merchant:profile:read` | membership required |
| `PATCH /api/v1/merchants/:id` | `merchant:profile:manage` | `OWNER`/`MANAGER` only |
| `GET /api/v1/admin/merchants` | `admin:merchants:review` | `page`/`limit`, optional `status` |
| `GET /api/v1/admin/merchants/:id` | `admin:merchants:review` | one registration |
| `POST /api/v1/admin/merchants/:id/approve` | `admin:merchants:review` | `200`, business becomes `ACTIVE` |
| `POST /api/v1/admin/merchants/:id/reject` | `admin:merchants:review` | `200`, body `{ "reason": "..." }` |

`POST /merchants` requires a token but declares no permission: it is how an
account becomes a merchant, so requiring `MERCHANT` would be circular. The grant
is the deliberate, audited exception documented in `SECURITY.md` and `ADR-025`.
The RUT is validated with its check digit, stored normalized (digits only,
`rut_normalized` unique) and immutable after creation; coordinates arrive as JSON
numbers and are stored and returned as fixed six-decimal strings
(`NUMERIC(9, 6)`).

Membership is the tenant check. A caller with no membership in `:id` receives
`404 MERCHANT_NOT_FOUND` - never `403` - so an id cannot be probed to learn
whether it exists. The merchant error codes are:

| Situation | Status | `code` |
| --------- | ------ | ------ |
| Unknown business, or caller is not a member | `404` | `MERCHANT_NOT_FOUND` |
| Transition the state machine does not allow | `409` | `MERCHANT_INVALID_STATE` |
| RUT already registered | `409` | `MERCHANT_RUT_CONFLICT` |
| RUT check digit fails, or unknown/disabled city | `400` | `VALIDATION_FAILED` |
| Register from an inactive account | `403` | `FORBIDDEN` |
| Update by a member without `OWNER`/`MANAGER` | `403` | `FORBIDDEN` |

`GET /admin/merchants` returns the offset envelope (`{ data, meta }` nested under
the response `data`), unlike the cursor-paginated `admin` module routes: the
merchant review queue is a bounded administrative list addressed by page.

---

# Documentation

OpenAPI document: `/api/docs` (Swagger UI) and `/api/docs-json`.

Paths already include the `/api/v1` prefix and the document declares no server
host, so it resolves against whatever origin serves it (reverse proxies and
multi-domain deployments must not be baked into the specification).