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
- Address-verification codes are opaque, single use and expire, and only their
  SHA-256 hash is stored. Issuing a new one invalidates any outstanding code for
  the same account, so "this is the only code that works" is true.
- A code is part of the lookup, not just a column. `EMAIL_VERIFY` and
  `EMAIL_CHANGE` are both opaque values hashed into the same table, so redeeming
  one must not satisfy the other.
- Activation after verification only moves a `PENDING_VERIFICATION` account
  forward. A code that arrives after an administrator suspended or disabled an
  account records the proof of the address and leaves the status alone, so a
  public endpoint cannot undo an administrative decision.
- `POST /auth/logout-all` revokes every session of the authenticated caller and
  answers with the number of sessions closed.

### Delivery of codes

The codes above reach the customer by email. That channel has its own rules:

- The plaintext exists in exactly two places: the delivery message and the
  customer's inbox. Nothing else - not the database, not the API response, not a
  log line - may carry it. The global redaction allowlist covers `token`,
  `verificationCode` and `smtpPassword`.
- A delivery failure never fails the operation it belongs to. A password reset
  completes server-side even when the mail host is down; otherwise an SMTP
  outage would let anyone invalidate every account's recovery code on demand
  (AGENTS.md section 23). The failure is recorded, not propagated.
- `Message-ID` is `sha256(idempotencyKey)`, never the key itself. The header
  crosses the internet and is quoted verbatim in bounces and DMARC reports.
- SMTP credentials require TLS. `SMTP_REQUIRE_TLS` defaults to `true` and the
  schema refuses `false` in staging/production and whenever `SMTP_USER` is set;
  `NodemailerMailTransport` refuses it again in its constructor so the guarantee
  does not depend on that schema being the only caller. Port 587 with
  `secure: false` is STARTTLS and is the supported submission path.
- `NOTIFICATION_PROVIDER=none` refuses every send and says so, rather than
  accepting a message it cannot deliver. A recovery request against it still
  succeeds and still produces a valid code - turning a provider on changes
  delivery and nothing else.
- The messages carry a code to type in, not a link. A link requires deep-link
  routing that does not exist yet, and the copy never asks for a password to be
  replied with.

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
| `POST /auth/verify-email` | 10 per IP / 1 h |

A blocked request answers `429` with `RATE_LIMITED` and
`details: { limit, retryAfterSeconds }`, so a client backs off without guessing.

`POST /auth/verify-email` is rate limited because it is public and accepts an
opaque value: without a budget it is an oracle for guessing codes. Wrong guesses
are also free of consequence by design - a rejected attempt does not consume the
code the legitimate holder has, because one code is worth more than an attacker's
attempt at a second.

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
| `ACCOUNT_APPROVAL_REQUIRED`   | `false` |
| `EMAIL_VERIFICATION_TTL_HOURS`| `24`    |
| `SMTP_REQUIRE_TLS`            | `true`  |
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
- `REQUIRE_EMAIL_VERIFICATION` and `ACCOUNT_APPROVAL_REQUIRED` are separate
  decisions. The first says an address must be proven; the second says that
  proving it is not enough on its own. With the second on, a proven address
  leaves the account `PENDING_VERIFICATION` and the API answers
  `canSignIn: false` rather than presenting an account the customer cannot use.
  A deployment that turns it on is responsible for having an approval path;
  the configuration cannot detect its absence;
- `REQUIRE_EMAIL_VERIFICATION=true` is rejected when
  `NOTIFICATION_PROVIDER=none`, because accounts would never receive the
  verification or recovery message;
- `NOTIFICATION_PROVIDER=smtp` requires `SMTP_HOST`, `SMTP_PORT` and
  `SMTP_FROM`; `SMTP_USER` and `SMTP_PASSWORD` must be set together; credentials
  are refused on any port other than 465/587; and `SMTP_REQUIRE_TLS=false` is
  refused outside development and whenever `SMTP_USER` is set;
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
- RBAC (`packages/auth`, 7 tests) - the permission matrix;
- `packages/notifications` (26 tests) - the SMTP provider refusing to pretend, a
  delivery failure resolving with `accepted: false` instead of throwing, template
  resolution across `es`/`pt` including the fallback chain, strict interpolation
  refusing both a missing and a surplus value, HTML escaping, a UTC date that
  survives an invalid locale, the `Message-ID` being a hash rather than the key,
  and the credentials-over-plaintext refusals;
- email verification through HTTP (5 tests) - the account stays pending until the
  code is proven, `canSignIn` distinguishing "proven" from "usable", a code
  refused twice, a code that was never issued, and `400` for a malformed body;
- `AuthService` verification and activation - proving an address activates it
  unless `ACCOUNT_APPROVAL_REQUIRED`, a suspended account is never resurrected
  through the public endpoint, and a provider that refuses the message still
  leaves a valid account behind.

Verified against real infrastructure (PostgreSQL 16 and Redis 7 outside the
repository; see `PROJECT_STATE.md` BLOCKED):

- the five Prisma adapters of the auth module (`*.integration.spec.ts`),
  including the verification-token adapter: a code is single use under two
  simultaneous redemptions, a code presented under the wrong `type` does not
  satisfy the check and does not burn the real one, an expired code is refused
  without being marked used, and `invalidateForUser` touches only the requested
  kind and only one account;
- activation after verification leaving a `SUSPENDED` and a `DISABLED` account
  exactly as they were, while still recording the proof of the address;
- the Redis rate limiter, including failing closed when Redis is unreachable
  (`redis-rate-limiter.integration.spec.ts`).

Verified manually against a real SMTP conversation (a local sink outside the
repository, not a committed fixture):

- both messages delivered as MIME with the right sender, subject, recipients and
  a `Message-ID` that is a hash rather than the token;
- the boot-time provider `verify()` reporting the host reachable;
- a full verification round trip: register (pending, no session) -> login refused
  with `403 EMAIL_NOT_VERIFIED` -> the code from the delivered message ->
  `POST /auth/verify-email` answering `verified: true, canSignIn: true` -> login
  succeeding -> the same code refused a second time;
- a full recovery round trip: request -> the code from the delivered message ->
  reset -> login with the new password -> the same code refused a second time;
- no plaintext code present in any log line.

Still unverified: the same suite running inside the CI `integration` job, which
is the only place the compose files themselves are exercised.

Not yet applicable, because the feature does not exist yet: IDOR on orders,
delivery code brute force, WebSocket room authorization, webhook signatures and
upload content-type spoofing.

## PHASE 04 status

The authorization mechanism itself is now covered. Until this, the three global
guards ran in front of every request and no test had ever reached them: no route
in the repository carried `@Roles()` or `@Permissions()`, so the matrix in
`packages/auth` was tested while the code that applies it to a request was not
tested at all.

- `RolesGuard` and `PermissionsGuard` (`rbac.guards.spec.ts`, 20 tests) - a
  route that declares nothing is allowed, which is not an open door because
  `JwtAuthGuard` still ran; `@Roles()` is satisfied by **any** listed role and
  `@Permissions()` by **all** of them; `ADMIN` does not pass a `SUPER_ADMIN`
  requirement; a role or permission name outside the matrix is refused for every
  caller including `SUPER_ADMIN`, so a typo fails closed rather than reading as
  "nothing was asked"; the refusal names what the route requires and never what
  the caller holds, so a protected endpoint cannot be used to map the policy; a
  missing principal is reported as a server fault rather than a `403` that would
  send the reader after the wrong problem
- `JwtAuthGuard` (`jwt-auth.guard.spec.ts`, 26 tests) - a public route never
  reaches the verifier and gets no principal; a missing, foreign-scheme or
  valueless header is refused without consulting it; the scheme is matched
  case-insensitively; the token reaches `verify()` and nothing else, so the
  request carries only `headers` and `principal`; unknown role names are dropped
  at this boundary; `TOKEN_EXPIRED` is the only rejection a client can recover
  from and the other six are `TOKEN_INVALID`, each keeping its reason for
  support; and a fault inside the verifier becomes a `500` whose message says
  nothing about the token
- the decorators and the principal lookup (`endpoint-security.spec.ts`, 12 tests)
  - including the recorded fact that **none of them validate anything**:
  `@Roles('ROOT')` and `@Permissions('admin:order:read')` store exactly what they
  were handed. The types stop a typo at compile time and nothing stops one at
  runtime, which is why the permission guard has to refuse an unknown name
  instead of treating it as no requirement

Two of these assertions were proven load-bearing rather than merely passing: the
"all permissions" check and the `500`-on-verifier-fault branch were each disabled
in the guard, the corresponding test failed, and the guard was restored byte for
byte afterwards. The `500` branch is the one that mattered most to find, because
reported as a `401` it would make every client read a server fault as "your
session is over", discard a valid refresh token and sign the user out.

One real defect was found while writing these: `principalFromRequest` tested
`principal === undefined` only, so middleware clearing the principal on sign-out
would have had `null` returned as if it were one, and the failure would have
surfaced later as a `TypeError` on `principal.roles` rather than at the one place
whose message names `JwtAuthGuard`.

Not yet proven: the matrix exercised end to end. No route uses `@Roles()` or
`@Permissions()`, `AdminModule` does not exist, and the seed creates neither
`SUPER_ADMIN` nor `SUPPORT` nor `FINANCE`, so a real deployment currently cannot
produce a caller that any of the `admin:*` permissions are about.