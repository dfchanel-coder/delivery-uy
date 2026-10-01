# ADR-012 - Realtime Architecture

Status: ACCEPTED

## Context

Customers need live driver position and order status; drivers need delivery
offers; merchants need incoming orders (AGENTS.md sections 16, 58, 12).

Constraints:

- every socket connection must authenticate (AGENTS.md section 58);
- customer GPS visibility must stop when the delivery ends (AGENTS.md
  section 34);
- multiple API instances must work, therefore pub/sub cannot be in-process
  only.

## Decision

- Transport: **Socket.IO** over WebSockets (see ARCHITECTURE.md). Gateway
  lives in `services/api` in the `RealtimeModule`.
- Authentication: during the Socket.IO handshake the client sends the
  short-lived access token in `auth.token`. The gateway verifies it with the
  same validator used by the HTTP guard and rejects unauthenticated
  connections. Long-lived refresh tokens are never accepted on sockets.
- Authorization: subscriptions are **room based and server assigned**. The
  client never chooses an arbitrary room name.

| Room                  | Who may join                                   |
| --------------------- | ---------------------------------------------- |
| `user:{userId}`       | the authenticated user only                    |
| `merchant:{merchantId}` | members with `MERCHANT` access to that merchant |
| `driver:{driverId}`   | the authenticated driver only                  |
| `admin:{role}`        | roles ADMIN, SUPER_ADMIN, SUPPORT, FINANCE     |

- Order events are published to `user:{customerId}`, `merchant:{merchantId}`
  and `driver:{driverId}` rooms only. There is no "subscribe to order X"
  client API, which eliminates the IDOR class described in SECURITY.md.
- Driver position is published at a throttled rate (default 5 s, configurable)
  and only while the driver is `ONLINE`, `DRIVER_ASSIGNED`, `PICKED_UP` or
  `IN_TRANSIT`. On `DELIVERED`, `CANCELLED` the backend emits
  `delivery.tracking.closed` and stops forwarding positions to customers.
- Current driver position is **not** stored in PostgreSQL as the source of
  truth. Live positions live in Redis with a short TTL (`GPS_POSITION_TTL`,
  default 120 s). `DriverLocation` rows, when enabled, are operational audit
  rows with a short retention window (`GPS_HISTORY_RETENTION`, default 24 h).
- Horizontal scale: Socket.IO Redis adapter (`@socket.io/redis-adapter`)
  broadcasts events between API instances.
- Events are emitted through the transactional outbox (`OutboxEvent`) or, for
  position updates, directly after the state change commits. Emitting before
  commit is forbidden.

## Consequences

- Realtime correctness depends on the state machine and the outbox, not on
  socket reliability; clients always re-fetch REST state on reconnect.
- Redis is required for multi-instance mode; single-instance development may
  run with an in-memory adapter.

## Alternatives considered

- **Raw `ws` library**: rejected, Socket.IO provides reconnection, rooms and
  the Redis adapter with less custom code.
- **Server-Sent Events**: rejected, one-directional only, no rooms.