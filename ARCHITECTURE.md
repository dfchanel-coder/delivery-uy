# DeliveryUY Architecture

Status: PHASE 00 finalized

Related documents:

- `DATABASE.md` - data rules
- `docs/ERD.md` - entity relationship design
- `docs/SCHEMA_PROPOSAL.md` - Prisma model proposal
- `docs/MODULE_BOUNDARIES.md` - layering, module contracts, import rules
- `SECURITY.md` - security baseline
- `LEGAL.md` - legal/fiscal review items
- `docs/decisions/*` - accepted ADRs

---

## 1. Architecture style

DeliveryUY is a **modular monolith** by design.

Reasons:

- easier development and deployment;
- real transactions across orders, payments and ledger;
- fewer distributed-systems failure modes;
- simpler debugging and incident response.

Modules stay separated enough to be extracted later if scale demands it. This
is a deliberate choice, not an accident.

Explicitly rejected for now: microservices, serverless functions per domain,
event-sourced core, CQRS frameworks, multi-master replication.

---

## 2. System context

```
Customer app (Flutter)   Merchant app (Flutter)   Driver app (Flutter)
Admin web (Next.js)              │                        │
                                  └──────────►  HTTPS /api/v1  ◄── WebSocket
                                                  │
                                        ┌─────────▼──────────┐
                                        │  services/api      │
                                        │  NestJS modular    │
                                        │  monolith          │
                                        └───┬──────────┬─────┘
                                            │          │
                              ┌─────────────▼──┐   ┌───▼───────────────┐
                              │ PostgreSQL     │   │ Redis             │
                              │ (source of     │   │ rate limits,      │
                              │  truth)        │   │ realtime state,   │
                              │                │   │ jobs, locks       │
                              └────────────────┘   └───┬───────────────┘
                                                     │
                              ┌──────────────────────▼────────────────────┐
                              │ Provider adapters (Map, Payment, Billing, │
                              │ Notification, Storage)                    │
                              └───────────────────────────────────────────┘
```

---

## 3. Repository layout

```
apps/
  customer/            Flutter
  merchant/            Flutter
  driver/              Flutter
  admin/               Next.js
services/
  api/                 NestJS backend (the only deployable backend initially)
packages/
  config/              validated bootstrap + runtime configuration
  database/            Prisma client and data access helpers
  types/               shared contracts
  auth/                hashing, token primitives, RBAC policies
  ui/                  admin design system
  maps/ payments/ billing/ notifications/ storage/    provider abstractions
infrastructure/
  docker/              compose files, init scripts
  nginx/               reverse proxy templates
  scripts/             operational scripts
docs/
  decisions/           ADRs
  ERD.md, MODULE_BOUNDARIES.md, SCHEMA_PROPOSAL.md, ...
```

Tooling: pnpm workspaces, TypeScript project references, shared ESLint/TS
configs. See `ADR-007`.

---

## 4. Backend

Framework: **NestJS + TypeScript** (strict mode).

Modules and their table ownership are defined in
`docs/MODULE_BOUNDARIES.md`.

Layering:

```
Controller (parse, validate, delegate)
  -> Application service (use case, transaction, provider call)
     -> Domain policy (pure rules, no I/O)
     -> Repository / provider adapter (infrastructure)
```

Rules:

- controllers hold no business logic and no Prisma calls;
- domain code has no framework or provider imports;
- only application services open transactions;
- provider SDKs exist only inside provider adapters.

---

## 5. Database

PostgreSQL is the authoritative source of truth. Prisma is the ORM. PostGIS is
added by a later migration when spatial zone editing requires it.

- UUID primary keys; separate human-quotable business codes;
- UTC `timestamptz` everywhere;
- money as `numeric(14,2)` + explicit `currency` (ADR-008);
- soft delete for business records; append-only for audit/ledger (ADR-009);
- snapshots on orders so history never depends on mutable configuration;
- migrations only; applied migrations are never rewritten (AGENTS.md
  section 96).

---

## 6. Cache, jobs and temporary state

Redis responsibilities:

- rate limiting and brute-force counters;
- driver live position with short TTL (ADR-012);
- Socket.IO pub/sub adapter for multi-instance fan-out;
- BullMQ queues: notifications, webhook retries, dispatch, settlement jobs,
  cleanup of expired sessions/idempotency keys;
- distributed locks for dispatch and settlement processing.

Redis is **never** authoritative for financial or order state. Losing Redis
must degrade realtime features, not corrupt data.

---

## 7. Mobile applications

Flutter (Dart):

- `apps/customer` - marketplace, cart, checkout, tracking, delivery code;
- `apps/merchant` - catalog, orders, hours, analytics;
- `apps/driver` - availability, offers, navigation, code verification.

Rules:

- no authoritative business rules in the client (AGENTS.md section 42);
- client-side validation exists only for UX;
- shared pure logic lives in `packages/dart/*`, never duplicated per app;
- offline tolerance: idempotency keys, retry with backoff, stale-GPS guards,
  no duplicate order submission on double tap.

---

## 8. Admin application

Next.js + TypeScript in `apps/admin`. Server-side session handling with the
same refresh-token rotation as mobile. Privileged actions require explicit
endpoints and `AuditLog` entries.

---

## 9. API

REST under `/api/v1`, documented with Swagger/OpenAPI at `/api/docs`.

Response envelope:

```json
{ "data": {}, "pagination": { "nextCursor": null } }
```

Error envelope:

```json
{ "error": { "code": "ORDER_INVALID_STATE", "message": "...", "details": {} } }
```

- structured errors only, never stack traces (AGENTS.md section 36);
- ISO 8601 UTC timestamps;
- money serialized as fixed 2-decimal strings (ADR-008);
- cursor pagination on large dynamic datasets;
- `Idempotency-Key` supported on order creation, payments, refunds (ADR-011).

---

## 10. Realtime

Socket.IO gateway in `services/api`. Handshake authentication with the access
token; room membership assigned by the server (`ADR-012`).

Events:

```
order.updated            delivery.location.updated
delivery.assigned        delivery.tracking.closed
dispatch.offer           merchant.order.created
```

Client-visible tracking stops on `DELIVERED`/`CANCELLED`.

---

## 11. Provider architecture

Every external vendor sits behind an interface. Domain logic depends only on
the interface.

| Interface              | v1 candidates                                |
| ---------------------- | --------------------------------------------- |
| `MapProvider`          | GoogleMapsProvider, MapboxProvider, OpenStreetMapProvider |
| `PaymentProvider`      | MercadoPagoProvider, CashPaymentProvider       |
| `BillingProvider`      | UruguayCFEProvider, ExternalBillingProvider   |
| `NotificationProvider` | FcmNotificationProvider, SmtpNotificationProvider |
| `StorageProvider`      | LocalDevelopmentStorage, S3CompatibleStorage   |
| `DispatchProvider`     | ProximityDispatchEngine                       |

No provider SDK import may appear outside its adapter package.

---

## 12. Domain flow

```
CUSTOMER -> ORDER CREATED -> PAYMENT -> MERCHANT ACCEPT -> PREPARING
   -> READY -> DISPATCH -> DRIVER ACCEPTED -> PICKUP -> IN TRANSIT
   -> ARRIVED -> DELIVERY CODE -> DELIVERED -> SETTLEMENT
```

Order transitions are owned by the `OrderStateMachine` (`ADR-006`); the
dispatch algorithm is owned by `DispatchEngine` (`ADR-015`). Neither logic
lives in a controller.

---

## 13. Cross-cutting concerns

| Concern          | Approach                                                        |
| ---------------- | --------------------------------------------------------------- |
| Auth             | short-lived JWT access + rotating refresh tokens (ADR-002)      |
| Authorization    | RBAC guards plus per-resource ownership checks                  |
| Idempotency      | `IdempotencyKey` + provider event uniqueness (ADR-011)          |
| Events           | transactional outbox; consumers may be replayed safely          |
| Observability    | structured pino logs, correlation ids, ports for metrics (ADR-014) |
| Configuration    | environment bootstrap + database runtime values (ADR-013)       |
| Testing          | unit for policies, real PostgreSQL for integration (ADR-016)    |
| Files            | `StorageProvider`, validated MIME/extension/size, signed URLs   |

---

## 14. Deployment

Development: Docker Compose with PostgreSQL and Redis.

Production components (independently deployable):

```
reverse proxy (HTTPS)
  -> api (N instances, stateless)
  -> worker (BullMQ consumers)
  -> admin web (static/SSR)
  -> postgresql (private, backups)
  -> redis (private)
  -> object storage (private bucket)
```

API instances are stateless: sessions, outbox state and locks live in the
database/Redis, so horizontal scaling needs no sticky sessions.

---

## 15. Scaling path

1. scale vertically while economical;
2. scale API instances and workers independently;
3. partition heavy tables (`orders`, `audit_logs`, `driver_locations`) when
   measured volume requires it;
4. extract realtime gateway or dispatch workers if their load diverges;
5. introduce microservices only with a concrete operational reason and a new
   ADR.

---

## 16. Architectural invariants

These rules are not negotiable without a new ADR:

1. PostgreSQL is the source of truth; Redis never stores financial truth.
2. Money never uses floating point.
3. Historical orders never depend on mutable catalog, address or commission
   configuration.
4. Order status is never set directly by a client.
5. The driver can never obtain the delivery code through any endpoint.
6. Authorization is always server-side and always resource-scoped.
7. Every external vendor is behind a provider interface.
8. No city-specific logic is hardcoded in application code.
9. Unresolved legal questions are marked `LEGAL_REVIEW_REQUIRED` instead of
   being guessed.
10. Business logic lives in services, not controllers, and not in clients.