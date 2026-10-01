# DeliveryUY Security Requirements

Status: PHASE 00 baseline

Supporting decisions: `ADR-002` (authentication), `ADR-010` (delivery code),
`ADR-011` (idempotency), `ADR-012` (realtime), `ADR-014` (observability and
redaction), `ADR-016` (testing topology).

Security is a mandatory architectural concern.

---

# Authentication

Use:

JWT access token
JWT refresh token

Access token:

short lifetime.

Refresh token:

longer lifetime
rotation enabled
hashed representation stored server-side

Support token/session revocation.

---

# Password Storage

Use:

Argon2id preferred.

Never store plaintext passwords.

Never log passwords.

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

Rules:

- JWT secrets must not equal the `.env.example` placeholder; startup fails
  otherwise in `staging`/`production`;
- refresh tokens are opaque random values; only their SHA-256 hash is stored;
- reuse of a rotated refresh token revokes the entire token family and raises a
  `RiskEvent`;
- secrets are read only through `packages/config`.

---

# Log Redaction

A global redaction allowlist replaces `password`, `passwordHash`, `token`,
`accessToken`, `refreshToken`, `authorization`, `cookie`, `secret`, `apiKey`,
`cardNumber`, `cvv`, `verificationCode`, `privateKey` and `smtpPassword` with
`[redacted]` before serialization (`ADR-014`).

Coordinates of customers and drivers are never written to info logs.

---

# Security Test Baseline

Covered in CI (`ADR-016`, `docs/TESTING.MD`):

- IDOR on every order, delivery, ticket and document endpoint;
- role escalation attempts for each role;
- expired, malformed and reused refresh tokens;
- delivery code brute force and lockout;
- unauthorized WebSocket room join;
- provider webhook signature failure;
- file upload content-type spoofing;
- rate-limit exhaustion on login and verification endpoints.