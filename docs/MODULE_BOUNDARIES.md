# DeliveryUY Module Boundaries

Status: PHASE 00 deliverable

Companion to `ARCHITECTURE.md`. `ADR-007` fixes the physical layout; this
document fixes the **logical** module contracts, ownership of tables and the
dependency matrix that ESLint will enforce.

---

## 1. Layering

```
            ┌───────────────────────────────────────────────┐
L4  API     │ Controllers (HTTP/WebSocket) — parse+validate  │
            ├───────────────────────────────────────────────┤
L3  APPL    │ Application services — use cases, transactions │
            ├───────────────────────────────────────────────┤
L2  DOMAIN  │ Entities, value objects, policies (pure)       │
            ├───────────────────────────────────────────────┤
L1  INFRA   │ Prisma repositories, providers, jobs, cache    │
            └───────────────────────────────────────────────┘
```

Rules:

- controllers contain **no** business logic and **no** Prisma calls
  (AGENTS.md sections 80, 81);
- domain layer has **zero** imports from `@prisma/client`, NestJS, Redis or any
  provider SDK. It receives plain data and returns plain data;
- application services are the only layer allowed to open transactions and to
  call providers;
- repositories wrap Prisma and enforce soft-delete filters and tenant scoping.

---

## 2. Backend modules (`services/api/src/modules`)

| Module         | Owns tables                                                        | Must not                                                  |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `auth`         | `users`, `user_roles`, `sessions`, `password_reset_tokens`, `verification_tokens` | pricing, dispatch, provider calls                  |
| `users`        | `users` (profile/status only)                                       | password hashing internals, role decisions                |
| `customers`    | `customer_profiles`, `addresses`, `favorites`                       | merchant approval, order pricing                          |
| `geo`          | `countries`, `cities`, `delivery_zones`                             | city-specific business rules (must stay data-driven)       |
| `merchants`    | `merchants`, `merchant_members`, `merchant_schedules`, `merchant_closures` | order state transitions, commission math              |
| `catalog`      | `categories`, `products`, `product_*`                               | order totals, stock reservation semantics                 |
| `drivers`      | `drivers`, `driver_documents`, `driver_locations`                   | dispatch decisions, delivery verification                |
| `orders`       | `orders`, `order_items`, `order_timeline`                           | provider SDKs; delegates transitions to `OrderStateMachine`|
| `delivery`     | `deliveries`, `driver_assignments`, `delivery_code_attempts`        | payment settlement, GPS history policy                    |
| `dispatch`     | `driver_assignments` (via `DispatchEngine` + jobs)                 | order creation, pricing                                   |
| `payments`     | `payments`, `refunds`, `payment_webhook_events`                    | trusting client-supplied payment status                   |
| `settlements`  | `ledger_accounts`, `journal_entries`, `ledger_entries`, `commissions`, `driver_earnings`, `settlements`, `settlement_items` | live order transitions                            |
| `billing`      | `billing_documents`                                                | order totals; vendor SDK                                   |
| `notifications`| `notifications`, `device_subscriptions`, `webhook_outbound`         | order state, payment state                                |
| `support`      | `support_tickets`, `support_messages`, `disputes`                   | automatic financial changes on dispute                    |
| `admin`        | read models + privileged commands                                   | bypassing module services                                 |
| `audit`        | `audit_logs`, `risk_events`                                        | business decisions (records only)                         |
| `platform`     | `system_config`, `feature_flags`, `idempotency_keys`, `outbox_events` | domain rules                                           |
| `realtime`     | none (Redis only)                                                  | reading private fields of unrelated resources             |

---

## 3. Cross-module dependency rules

Allowed (module -> module):

```
auth        -> users, platform, audit
customers   -> auth, geo
geo         -> platform
merchants   -> auth, geo, platform, audit
catalog     -> merchants, platform
drivers     -> auth, geo, platform, audit
orders      -> auth, customers, merchants, catalog, geo, platform, audit
delivery    -> orders, drivers, platform, audit, realtime
dispatch    -> drivers, geo, platform, realtime, audit
payments    -> orders, platform, audit
settlements -> orders, payments, platform, audit
billing     -> orders, settlements, platform, audit
notifications -> platform, audit           (event consumers only)
support     -> auth, orders, audit
admin       -> every module's application service (never their repositories)
```

Forbidden without a new ADR:

- any module importing another module's **repository** or Prisma model
  directly; cross-module data access goes through the owning module's
  application service;
- `catalog` or `orders` importing a payment/map/storage SDK;
- `dispatch` importing `orders` internals other than the public transition API;
- `notifications`, `audit` and `realtime` performing writes to business tables;
- `admin` re-implementing validation that already exists in a domain policy.

Circular dependencies are a build error. Shared logic that two domains need
must be extracted to `packages/*` as a pure module (for example
`packages/money`, `packages/order-state`).

---

## 4. Packages (`packages/*`)

| Package          | Responsibility                                              | Layer  |
| ---------------- | ----------------------------------------------------------- | ------ |
| `config`         | validated, frozen bootstrap configuration + runtime config port | L1 |
| `database`       | Prisma client, extension clients, transaction helpers, soft-delete filters | L1 |
| `types`          | cross-surface DTO and event type contracts (no logic)        | L2     |
| `auth`           | password hashing, token sign/verify primitives, RBAC policy evaluation (pure) | L2 |
| `money`          | `Decimal` helpers, rounding, formatting (planned)            | L2     |
| `maps`           | `MapProvider` interface + adapters                            | L1     |
| `payments`       | `PaymentProvider` interface + adapters                        | L1     |
| `billing`        | `BillingProvider` interface + adapters                       | L1     |
| `notifications`  | `NotificationProvider` interface + adapters                  | L1     |
| `storage`        | `StorageProvider` interface + adapters (private/signed URLs) | L1     |
| `ui`             | React/Next shared design-system components (admin only)      | UI     |
| `eslint-config`  | shared lint rules including boundary enforcement             | tool   |
| `typescript-config` | shared `tsconfig` presets                                | tool   |

Package rules:

- no package may import from `apps/*` or `services/*` (ADR-007);
- provider interfaces live with their adapters; domain modules depend on the
  interface only;
- `packages/database` must not import any domain package;
- each package has unit tests for its public surface.

---

## 5. Shared packages for mobile (`packages/dart/*`)

Flutter code must not re-implement pricing, state transitions or permissions.

| Package          | Responsibility                                   |
| ---------------- | ------------------------------------------------ |
| `core_api_client`| typed HTTP client, auth interceptor, retries    |
| `core_domain`    | pure models, order state labels, money formatting |
| `core_ui`        | shared widgets and design tokens                |

Created in PHASE 01 only if a concrete app requires them; an empty package
directory is not a deliverable.

---

## 6. Enforcement

| Rule                                | Mechanism                                        |
| ----------------------------------- | ------------------------------------------------ |
| import direction                    | ESLint `import/no-restricted-paths` + project references |
| no `any`                            | ESLint `@typescript-eslint/no-explicit-any: error` |
| strict TS                            | `strict: true`, `noUncheckedIndexedAccess: true` |
| no direct Prisma in controllers     | ESLint `no-restricted-imports` for `@prisma/client` in `**/*.controller.ts` |
| no `process.env` outside `config`   | ESLint `no-restricted-properties`                |
| no floats for money                 | review rule + `Decimal` helpers                  |
| business rules in services          | reviewed in code review; controller line budget  |

---

## 7. Definition of done for a module

A module is complete only when:

1. its public surface is exposed through an application service;
2. authorization is explicit (guard + ownership check);
3. every state change writes the timeline/audit record it promises;
4. unit tests cover policies and integration tests cover persistence;
5. Swagger annotations exist for every endpoint;
6. no forbidden import is present;
7. documentation (`docs/`) and `PROJECT_STATE.md` are updated.