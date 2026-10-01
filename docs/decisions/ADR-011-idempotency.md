# ADR-011 - Idempotency Strategy

Status: ACCEPTED

## Context

AGENTS.md sections 38, 43 and 59 require idempotency for order creation,
payments, payment webhooks, refunds and webhook delivery. Mobile clients on
unstable networks frequently retry requests (AGENTS.md section 43).

## Decision

### `IdempotencyKey` table

Columns: `scope`, `key`, `userId`, `requestHash`, `status`,
`resourceType`, `resourceId`, `responseStatus`, `responseBody`,
`lockedAt`, `expiresAt`, `createdAt`.

Unique constraint: `(scope, key)`.

Scopes are stable strings owned by the owning module, for example:

- `orders:create`
- `payments:create`
- `refunds:create`
- `webhook:{provider}`

### Protocol

1. Client may send `Idempotency-Key` (or `X-Idempotency-Key`) for any
   `POST` that creates a financial or order resource.
2. Backend hashes the canonical request body (`requestHash`, SHA-256 of the
   stable JSON serialization).
3. If a row exists with a different `requestHash`, respond `409
   IDEMPOTENCY_KEY_REUSED`.
4. If a row exists with status `COMPLETED`, replay the stored
   `responseStatus` / `responseBody`.
5. If a row exists with status `IN_PROGRESS` and a fresh lock, respond `409
   IDEMPOTENCY_REQUEST_IN_PROGRESS`.
6. Otherwise the operation runs inside the same transaction that inserts the
   key row with the resulting resource id, guaranteeing exactly-once effect.

Retention: 7 days for client keys, 30 days for provider webhook events.

### Provider webhooks

- `PaymentWebhookEvent` unique on `(provider, providerEventId)` is the primary
  guard; signature verification occurs **before** the uniqueness check is
  trusted to short-circuit the handler.
- Unknown event types are stored with status `IGNORED` for later inspection,
  never silently discarded.
- Handler retries are driven by `status`, `attempts` and `availableAt`.

## Consequences

- Storage cost is small and bounded by retention.
- Replay semantics guarantee no double orders, no double charges and no double
  refunds.
- Requires a canonical JSON serializer (sorted keys) in `packages/config` or a
  shared util so hashing is stable across services.