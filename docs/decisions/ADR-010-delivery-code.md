# ADR-010 - Delivery Verification Code Design

Status: ACCEPTED

## Context

AGENTS.md sections 14 and 15 require that a delivery can only be completed by
proving that the customer (not the driver) possesses the code. The driver must
never be able to read the code through the API.

## Decision

### Code properties (configurable, no magic constants - AGENTS.md section 52)

| Parameter                     | Default | Config key                  |
| ----------------------------- | ------- | --------------------------- |
| Length                        | 6       | `DELIVERY_CODE_LENGTH`      |
| Numeric only                  | yes     | `DELIVERY_CODE_NUMERIC_ONLY`|
| Validity window               | 24 h    | `DELIVERY_CODE_TTL`         |
| Max verification attempts     | 5       | `DELIVERY_CODE_MAX_ATTEMPTS`|
| Lockout on exhaustion         | 15 min  | `DELIVERY_CODE_LOCK_MINUTES`|

Ranges are validated on startup by `packages/config` (length 4-6,
`numeric only` implies digits 0-9).

### Storage

- The plaintext code **never** leaves the backend twice: it is generated once,
  returned only to the order owner (customer) channel, and only a
  **salted hash** (`scrypt` with per-delivery random salt, see
  `packages/auth` password-hashing family) plus the salt and
  `verificationCodeExpiresAt` are persisted.
- Plaintext is never logged, never placed in URLs, never included in
  `AuditLog.metadata`.

### Verification

1. `POST /api/v1/deliveries/:id/verify` is authenticated as DRIVER (or a
   privileged role) and the driver must be the currently assigned driver.
2. Server-side constant-time comparison of the supplied code against the
   stored hash.
3. Every attempt increments `Delivery.verificationAttempts` and inserts a
   `DeliveryCodeAttempt` row (success flag, driver, IP, timestamp).
4. Reaching the attempt limit sets `verificationLockedAt` for the configured
   lockout period and returns `DELIVERY_CODE_LOCKED`. Attempts are counted per
   delivery and additionally rate-limited per driver and per IP.
5. Successful verification sets `verifiedAt` and `verifiedByUserId`, consumes
   the code (`codeConsumedAt`), and is the only automated path to
   `Order.status = DELIVERED`.

### Anti-enumeration

- The customer channel endpoint (`GET /api/v1/orders/:id/delivery-code`)
  returns `404` for non-owners and for states where the code is not active.
- Driver-facing responses never distinguish "wrong code" from "expired code"
  beyond a generic `DELIVERY_CODE_INVALID`.

### Exception flow

Manual completion (`POST /api/v1/admin/deliveries/:id/exception-complete`)
requires:

- role `ADMIN` or `SUPPORT` **and** an explicit
  `X-Requires-Second-Approver` escalation for `SUPER_ADMIN`-level action,
- a mandatory textual reason,
- `AuditLog` entry with actor, reason and correlation id,
- optional neutral `RiskEvent` creation.

The order then transitions to `DELIVERED` through the same state machine with
an `EXCEPTION_VERIFIED` timeline event.

## Consequences

- The customer may lose the code; the exception path is the only recovery and
  is fully audited.
- Attempt tracking creates write amplification per verification, which is
  acceptable (few attempts per delivery).
- Resetting the code is not supported after `DRIVER_ASSIGNED` to preserve
  auditability of the originally issued code.