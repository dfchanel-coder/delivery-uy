# DeliveryUY Security Requirements

Status: PHASE 03 baseline

Supporting decisions: `ADR-002` (authentication), `ADR-010` (delivery code),
`ADR-011` (idempotency), `ADR-012` (realtime), `ADR-014` (observability and
redaction), `ADR-016` (testing topology), `ADR-020` (cryptography libraries).

Security is a mandatory architectural concern.

---

# Authentication

Use:

JWT access token
opaque refresh token

Access token:

short lifetime, stateless, signed HS256 (`jose`), with `iss`, `aud`, `typ`,
`jti`, `sub` and `roles` claims.

Refresh token:

longer lifetime
rotation enabled
hashed representation stored server-side

Support token/session revocation.

## Concrete design (`ADR-002`, implemented in PHASE 03)

- The access token is the only JWT. It is verified statelessly, so no database
  round trip guards an ordinary request; revocation takes effect at the next
  refresh, which is why the lifetime is short.
- Refresh tokens are **opaque random strings**. Only their SHA-256 hash is
  persisted, so a database leak does not yield usable credentials.
- A refresh belongs to a **token family** (`tokenFamilyId`). Rotation is a
  conditional `UPDATE ... WHERE revoked_at IS NULL` inside a transaction: the
  sentinel that loses the race means the token was already rotated, which is
  replay. Replay revokes the entire family and raises a `RiskEvent`.
- Password recovery tokens behave the same way: single use, enforced by a
  conditional update, and they revoke every existing session on completion.
- `POST /auth/logout-all` revokes every session of the authenticated caller and
  answers with the number of sessions closed.

### Access token claims

| Claim   | Meaning |
| ------- | ------- |
| `sub`   | user id (uuid) |
| `roles` | array of granted roles |
| `typ`   | `access` - rejects a refresh token presented as a bearer token |
| `sid`   | session id, so a future "list my devices" screen needs no new token |
| `jti`   | token id, for correlation and future revocation lists |
| `iss`/`aud` | pinned on every verification |

The claims a client receives are read back from the signed token rather than
recomputed locally, so `issuedAt`/`expiresAt` can never disagree with the `exp`
the client will see.

Algorithm, issuer and audience are pinned on every `jose` call, so `alg: none`,
a swapped algorithm and a foreign-issuer token are rejected by construction
rather than by inspection.

---

# Password Storage

Use:

Argon2id preferred.

Never store plaintext passwords.

Never log passwords.

## Concrete design (PHASE 03)

- Hashing is exposed only through `packages/auth`: `hashPassword`,
  `verifyPassword`, `verifyPasswordOrDummy`, `passwordNeedsRehash`
  (`ADR-020`). Call sites cannot select another algorithm.
- The parameters used are embedded in the stored hash
  (`$argon2id$v=19$m=...,t=...,p=...$...`), so raising the policy invalidates
  nothing: the next successful login rehashes.
- `verifyPasswordOrDummy` always performs one Argon2id verification, even for an
  unknown account, so response time does not reveal whether an address exists.
  Login answers `INVALID_CREDENTIALS` for both "no such account" and "wrong
  password".
- A failed login increments `failed_login_attempts`; `LOGIN_MAX_ATTEMPTS`
  failures set `locked_until` for `LOGIN_LOCK_MINUTES` and the account answers
  `ACCOUNT_LOCKED` (`429`). The counter resets on success.
- The seed creates real Argon2id hashes through the same package; there is no
  placeholder hash anywhere in the repository.

---

# Authorization

Use RBAC.

Authorization must always happen on backend.

Protect against IDOR.

Example:

A customer requesting:

GET /orders/:id

must be verified as the owner or an authorized privileged role.

Knowing an ID is not authorization.

---

# Rate Limits

Apply to:

login
register
password reset
delivery code verification
payment-sensitive endpoints
public expensive endpoints

## Concrete design (PHASE 03)

The limiter is a port (`RateLimiter`) with two backends:

- `RATE_LIMIT_BACKEND=redis` (default). The increment and the `EXPIRE` are one
  Lua script, so a window can never survive without a TTL. Several API instances
  share one counter.
- `RATE_LIMIT_BACKEND=memory`. Correct only while a single instance serves the
  traffic; the tests use it and it is an explicit development choice.

Rules:

- **Fails closed.** If the store is unreachable the request is refused with
  `SERVICE_UNAVAILABLE` (`503`). An attacker who can take Redis down must not
  thereby remove the limit. Readiness reports the outage separately.
- Every budget is keyed by scope: `ip`, `email` or `user`. Account-scoped budgets
  are additional to the per-address one, never a replacement, so one attacker
  cannot lock every account from one address.
- `@RateLimit(...)` is declared on the controller so the whole public surface can
  be reviewed in one place; the guard applies it before the handler runs.

Limits currently in force (fixed window, `limit` per `windowSeconds`):

| Route | Budget |
| ----- | ------ |
| `POST /auth/register` | 10 per IP / 15 min, 3 per email / 1 h |
| `POST /auth/login` | 20 per IP / 5 min, 10 per email / 15 min |
| `POST /auth/refresh` | 60 per IP / 15 min |
| `POST /auth/logout` | 60 per IP / 15 min |
| `POST /auth/logout-all` | 20 per user / 15 min |
| `POST /auth/password/forgot` | 10 per IP / 1 h, 3 per email / 1 h |
| `POST /auth/password/reset` | 10 per IP / 1 h |

A blocked request answers `429` with `RATE_LIMITED` and
`details: { limit, retryAfterSeconds }`, so a client backs off without guessing.

---

# Delivery Codes

Code generated server-side.

Never return through driver APIs.

Store hash where practical.

Limit failed attempts.

Log verification events.

Concrete design (`ADR-010`):

- 6 digits by default (`DELIVERY_CODE_LENGTH`, range 4-6);
- salted `scrypt` hash + expiry stored in `deliveries`;
- plaintext returned only through the customer-owned endpoint;
- every attempt persisted in `delivery_code_attempts` (append-only);
- 5 attempts (`DELIVERY_CODE_MAX_ATTEMPTS`) then a 15 minute
  (`DELIVERY_CODE_LOCK_MINUTES`) lock, plus per-driver and per-IP rate limits;
- manual completion is a privileged, reason-required, audited action.

---

# Payments

Never trust client payment status.

Always verify provider state.

Webhooks:

verify authenticity
support idempotency
avoid duplicate processing

---

# File Uploads

Validate:

size
extension
MIME type
authorization

Use generated internal filenames.

Private documents must remain private.

---

# Secrets

Use environment variables.

Never commit:

.env
private keys
API secrets
provider tokens

---

# API

Enable:

Helmet
controlled CORS
input validation
DTO validation
request size limits

Production should use HTTPS only.

---

# Logging

Never log:

passwords
access tokens
refresh tokens
payment card information
private identity documents

---

# WebSockets

Authenticate connections.

Authorize subscriptions.

Customer must not subscribe to arbitrary order streams.

Driver must not subscribe to unrelated deliveries.

---

# Admin

Important administrative actions require AuditLog.

Future production enhancement:

MFA for privileged users.

---

# Database

Use least privilege database accounts.

Production database should not be publicly reachable.

Backups should be encrypted where feasible.

---

# Dependencies

Review dependency security.

Automated dependency scans should be enabled in CI.

---

# Incident Readiness

Architecture should allow:

session revocation
account suspension
provider key rotation
audit inspection
API rate restriction

---

# Password and Token Parameters

Configurable through `packages/config` and validated at startup:

| Parameter                      | Default |
| ------------------------------ | ------- |
| `JWT_ACCESS_EXPIRES_IN`       | `15m`   |
| `JWT_REFRESH_EXPIRES_IN`      | `30d`   |
| `PASSWORD_ARGON2_MEMORY_KIB`  | `65536` |
| `PASSWORD_ARGON2_ITERATIONS`  | `3`     |
| `LOGIN_MAX_ATTEMPTS`          | `5`     |
| `LOGIN_LOCK_MINUTES`          | `15`    |
| `PASSWORD_RESET_TTL_HOURS`    | `2`     |
| `REQUIRE_EMAIL_VERIFICATION`  | `false` |
| `REGISTER_DEFAULT_ROLE`       | `CUSTOMER` (the only accepted value) |
| `TRUST_PROXY_HOPS`            | `0`     |
| `RATE_LIMIT_BACKEND`          | `redis` |

Rules:

- JWT secrets must not equal the `.env.example` placeholder; startup fails
  otherwise in `staging`/`production`;
- refresh tokens are opaque random values; only their SHA-256 hash is stored;
- reuse of a rotated refresh token revokes the entire token family and raises a
  `RiskEvent`;
- secrets are read only through `packages/config`;
- `REGISTER_DEFAULT_ROLE` accepts only `CUSTOMER`. The schema cannot express
  `ADMIN` or `MERCHANT`, so self-registration can never grant an elevated role
  even by misconfiguration (AGENTS.md section 8);
- `REQUIRE_EMAIL_VERIFICATION=true` is rejected when
  `NOTIFICATION_PROVIDER=none`, because accounts would never receive the
  verification or recovery message;
- `TRUST_PROXY_HOPS` is the number of reverse proxies the deployment actually
  declares. It must stay `0` behind no proxy: setting it blindly lets any caller
  forge the `X-Forwarded-For` address used by rate limits and audit records.

### Self-registration cannot escalate

`POST /auth/register` always creates exactly one `CUSTOMER` role. There is no
request field for a role, and the default comes from configuration that accepts
no value other than `CUSTOMER`.

---

# Client Credential Storage

Use:

- platform keystore or keychain for any persisted credential
- never `SharedPreferences`, never a plain file

Rules:

- only the refresh token is persisted; the access token is short lived and is
  obtained again on launch
- a stored credential is namespaced by the API origin that issued it
- sign-out removes the stored value before it attempts revocation

## Concrete design (PHASE 03, `ADR-021`)

- `TokenStore` is a port in `packages/dart/core` (`read`, `write`, `clear`); the
  plugin-backed implementation lives in the application, so the shared package
  stays free of platform dependencies and each build supplies its own.
- `SecureTokenStore` in `apps/customer` wraps `flutter_secure_storage`. On
  Android 11+ the value is AES-GCM under a key wrapped by the Keystore; on iOS
  it is a keychain item with `first_unlock_this_device`, which keeps it out of
  backup migrations. The store is discarded when the application is uninstalled.
- `StoredSession` carries `apiBaseUrl`, and the key is derived from it. Secure
  storage is scoped to the application install, not to the deployment, so a
  debug build and a release build on one device would otherwise share a keyspace
  and a debug build could replay a token issued by production.
- `resetOnError` stays at the plugin default. An entry whose wrapping key was
  lost cannot be decrypted, so dropping it and asking the user to sign in again
  is the only honest outcome; the alternative is an application that cannot
  start.
- The port exists because `SecureTokenStore` itself cannot be unit tested: it is
  a platform channel. The logic around it is tested against `InMemoryTokenStore`
  (7 tests) and the plugin is proven by running it on a device, recorded in
  `PROJECT_STATE.md`.

---

# Log Redaction

A global redaction allowlist replaces `password`, `passwordHash`, `token`,
`accessToken`, `refreshToken`, `authorization`, `cookie`, `secret`, `apiKey`,
`cardNumber`, `cvv`, `verificationCode`, `privateKey` and `smtpPassword` with
`[redacted]` before serialization (`ADR-014`).

Coordinates of customers and drivers are never written to info logs.

---

# Security Test Baseline

Required before the relevant phase can close (`ADR-016`, `docs/TESTING.MD`):

- IDOR on every order, delivery, ticket and document endpoint;
- role escalation attempts for each role;
- expired, malformed and reused refresh tokens;
- delivery code brute force and lockout;
- unauthorized WebSocket room join;
- provider webhook signature failure;
- file upload content-type spoofing;
- rate-limit exhaustion on login and verification endpoints.

## PHASE 03 status

Written and passing locally:

- token handling in `packages/auth` (13 tests) - round trip, an expiry consistent
  with the token contents, a unique `jti` per token, a secret shorter than the
  minimum rejected at construction, and rejection of another secret, an unsigned
  token (`alg: none`), a missing or malformed payload, an expired token, another
  issuer or audience, a token whose `typ` is not `access`, and a `roles` claim
  that is not an array of strings;
- password hashing (17 tests) - a verifiable Argon2id hash, wrong password
  refused, the plaintext never stored, a per-password salt, a non-Argon2id hash
  failing closed, the parameters documented here are the defaults, parameters
  outside the safe range refused, rehash detection for a weaker or unparseable
  hash, and the dummy verification that keeps the work of an unknown account
  constant;
- `AuthService` (33 tests) - registration, duplicate address regardless of
  casing, password policy, login, case-insensitive address, identical answer for
  a wrong password and an unknown account, account lock at the threshold and
  unlock when it expires, disabled and suspended accounts, hash upgrade,
  soft-deleted account, refresh rotation, replay closing the whole family,
  expired and unknown tokens, a session whose account changed after login,
  idempotent logout, logout-all, password recovery that answers identically for
  a known and an unknown address, single-use reset token, reset revoking every
  session, and the plaintext token never appearing outside the delivery channel;
- `AuthController` over real HTTP (22 tests) - `201` with a session, `409` for a
  duplicate address, `400` for malformed and unknown fields, `401` for a missing
  token, a foreign signature and a non-bearer scheme, no password or hash echoed
  back, `429` on login bursts, and a separate budget per address;
- the configuration schema refuses `REGISTER_DEFAULT_ROLE=ADMIN` or `=MERCHANT`
  (`packages/config`), which is what makes role escalation from a public route
  impossible rather than merely unlikely;
- RBAC (`packages/auth`, 7 tests) - the permission matrix.

Verified against real infrastructure (PostgreSQL 16 and Redis 7 outside the
repository; see `PROJECT_STATE.md` BLOCKED):

- the four Prisma adapters of the auth module (`*.integration.spec.ts`);
- the Redis rate limiter, including failing closed when Redis is unreachable
  (`redis-rate-limiter.integration.spec.ts`).

Still unverified: the same suite running inside the CI `integration` job, which
is the only place the compose files themselves are exercised.

Not yet applicable, because the feature does not exist yet: IDOR on orders,
delivery code brute force, WebSocket room authorization, webhook signatures and
upload content-type spoofing.