# DeliveryUY Database Architecture

Status: PHASE 02 - schema and migration `0001_init` written, not yet applied to
a live database (see "Applied Schema" below and ADR-019)

Detailed model:

- `docs/ERD.md` - entity relationships, cardinality, constraints, indexes,
  retention
- `docs/SCHEMA_PROPOSAL.md` - Prisma proposal, raw SQL requirements, seed plan
- `ADR-008` money, `ADR-009` identifiers/timestamps/soft delete/transactions

The entity lists below are the conceptual summary. `docs/ERD.md` is the
authoritative field-level design.

Database:

PostgreSQL

ORM:

Prisma

Geographic extension:

PostGIS when required.

---

# General Rules

Use UUID identifiers.

All timestamps stored in UTC.

Money uses Decimal/NUMERIC.

Never use float for money.

Use explicit currency.

Soft delete where appropriate.

Financial records must preserve historical data.

---

# Initial Entities

## User

Fields conceptually:

id
email
phone
passwordHash
status
createdAt
updatedAt

User may have roles.

---

## UserRole

userId
role

Roles:

CUSTOMER
MERCHANT
DRIVER
ADMIN
SUPER_ADMIN
SUPPORT
FINANCE

---

## Session

id
userId
refreshTokenHash
deviceInfo
ipAddress
expiresAt
revokedAt
createdAt

---

## CustomerProfile

id
userId
firstName
lastName
photoUrl
createdAt
updatedAt

---

## Address

id
userId
label
street
number
apartment
cityId
latitude
longitude
instructions
createdAt
updatedAt

---

## City

id
countryCode
name
departmentOrState
timezone
currency
enabled

Initial country:

UY

Initial currency:

UYU

---

## DeliveryZone

id
cityId
name
geometry
enabled

---

## Merchant

id
ownerUserId
cityId
tradeName
legalName
rut
description
status
phone
email
latitude
longitude
address
createdAt
updatedAt

Statuses:

PENDING_REVIEW
ACTIVE
REJECTED
SUSPENDED
DISABLED

---

## MerchantMember

id
merchantId
userId
role
createdAt

---

## MerchantSchedule

id
merchantId
dayOfWeek
openTime
closeTime
enabled

---

## Category

id
merchantId nullable
parentId nullable
name
slug
enabled

---

## Product

id
merchantId
categoryId
name
description
basePrice
currency
stockManaged
stock
enabled
createdAt
updatedAt

---

## ProductVariant

id
productId
name
priceDelta
stock
enabled

---

## ProductAddon

id
productId
name
price
enabled

---

## Driver

id
userId
cityId
status
availability
vehicleType
rating
createdAt
updatedAt

---

## DriverDocument

id
driverId
type
storageKey
status
expiresAt nullable
createdAt

---

## DriverLocation

Prefer realtime temporary storage when possible.

Persist only where operationally or legally necessary.

If persisted:

id
driverId
latitude
longitude
accuracy
recordedAt

Retention must be limited.

---

## Order

id
customerId
merchantId
driverId nullable
status
currency

subtotal
discount
deliveryFee
serviceFee
tax
total

deliveryAddressSnapshot JSON
merchantSnapshot JSON

createdAt
updatedAt
acceptedAt
readyAt
pickedUpAt
deliveredAt
cancelledAt

---

## OrderItem

id
orderId
productId nullable

productNameSnapshot
variantSnapshot
addonsSnapshot

quantity
unitPrice
total

---

## OrderTimeline

id
orderId
status
actorUserId nullable
metadata
createdAt

---

## Delivery

id
orderId
driverId nullable

pickupLatitude
pickupLongitude
dropoffLatitude
dropoffLongitude

verificationCodeHash
verificationAttempts
verificationExpiresAt

createdAt
updatedAt

---

## DriverAssignment

id
deliveryId
driverId
status
offeredAt
respondedAt

Statuses:

OFFERED
ACCEPTED
REJECTED
EXPIRED
CANCELLED

---

## Payment

id
orderId
provider
providerPaymentId
status
amount
currency
metadata
createdAt
updatedAt

---

## Refund

id
paymentId
amount
reason
providerRefundId
status
createdAt

---

## Commission

id
orderId
merchantId
type
rate
amount
currency
createdAt

Values must represent order-time snapshot.

---

## DriverEarning

id
orderId
driverId
amount
currency
status
createdAt

---

## Settlement

id
beneficiaryType
beneficiaryId
amount
currency
status
periodStart
periodEnd
createdAt
paidAt

---

## AuditLog

id
actorUserId nullable
actorRole nullable
action
entityType
entityId
metadata
ipAddress
userAgent
createdAt

---

# Critical Snapshot Rule

Historical orders must not depend on mutable product configuration.

Snapshot:

product name
variant
addons
unit price
merchant data
delivery address
commission data
financial totals

---

# Migration Policy

Never manually modify production database structures.

Every change goes through migration.

Old applied production migrations should not be rewritten.

Create new migrations instead.

---

# Concrete Type Conventions

| Concern     | PostgreSQL type              | Notes                                          |
| ----------- | ---------------------------- | ---------------------------------------------- |
| Primary key | `uuid`                      | `uuidv4()` default                            |
| Money       | `numeric(14,2)`              | plus `currency char(3)` (ADR-008)              |
| Rate        | `numeric(7,4)`              | commission percentages                          |
| Coordinates | `numeric(9,6)`              | with `CHECK` range constraints                 |
| Timestamp   | `timestamptz(3)`            | UTC only (ADR-009)                             |
| Time of day | `varchar(5)` `HH:mm`        | timezone lives on `City`/`Merchant`             |
| Phone       | `varchar(20)`               | E.164                                           |
| Email       | `varchar(255)`              | lower-cased, functional unique index            |
| IP          | `varchar(45)`               | IPv6 safe                                      |
| JSON        | `jsonb`                     | snapshots, metadata, payloads                  |
| Text        | `text`                      | long descriptions                               |
| Code        | `varchar(160)`              | public human-quotable codes                    |

Rating averages use `numeric(3,2)` in `[0,5]`.

---

# Database-Enforced Integrity

Application-only rules are not acceptable when the database can enforce the
invariant. `0001_init` adds, via hand-written SQL in the same migration:

- `CHECK` for coordinates, stock `>= 0`, `quantity > 0`, non-negative amounts,
  `day_of_week BETWEEN 0 AND 6`, `rollout_percentage BETWEEN 0 AND 100`,
  rating range;
- functional unique index on `lower(email)` for non-deleted users;
- partial unique indexes: one default variant per product, one `ACCEPTED`
  driver assignment per delivery, one default address per user, one
  platform-level category slug;
- unique constraints on webhook event ids, idempotency keys, business codes,
  RUT, order code, delivery code hash, session refresh hash;
- deferred constraint trigger asserting balanced `JournalEntry` (PHASE 15);
- **no** `ON DELETE CASCADE` from users, merchants or orders toward financial,
  ledger or audit tables.

Index strategy and per-table index list: `docs/ERD.md`.

---

# Transaction Boundaries

The following operations are atomic and must not be split:

| Operation            | Must include                                                   |
| -------------------- | -------------------------------------------------------------- |
| Order creation       | order + items + timeline + idempotency key + outbox event        |
| Payment approval     | payment + order transition + timeline + outbox event             |
| Delivery completion  | delivery verification + order transition + ledger posting + timeline |
| Dispatch acceptance  | conditional assignment update + delivery + order transition     |
| Refund               | refund + payment update + order transition + ledger posting      |
| Settlement posting   | settlement + items + ledger balances                             |

Domain events are written to `outbox_events` inside the same transaction so
notifications and analytics never depend on in-process event delivery.

---

# Retention

| Data                              | Default retention                      |
| --------------------------------- | -------------------------------------- |
| `driver_locations`                | 24 h (`GPS_HISTORY_RETENTION`)         |
| live driver position in Redis     | 120 s TTL (`GPS_POSITION_TTL`)         |
| revoked/expired `sessions`        | 30 days after expiry                    |
| `idempotency_keys`                | 7 days client / 30 days webhook         |
| published `outbox_events`         | 7 days                                  |
| `audit_logs`, `order_timeline`, `ledger_entries` | legal requirement      |

Retention of financial, audit and personal data is
`LEGAL_REVIEW_REQUIRED` (see `LEGAL.md`).

---

# Applied Schema

Migration `0001_init` was created in PHASE 02. It is **written and statically
verified, but not yet applied to a running database**: the development machine
has no usable PostgreSQL (PROJECT_STATE.md, BLOCKED). Applying it is proven by
the CI `integration` job (ADR-019).

| File                                                  | Role                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| `packages/database/prisma/schema.prisma`               | Source of truth: 42 models, 26 enums                            |
| `packages/database/prisma/migrations/0001_init/`        | Generated DDL + hand-written constraints                         |
| `packages/database/prisma/manual/0001_init_constraints.sql` | Constraints Prisma cannot express (partial/functional indexes, `CHECK`) |
| `packages/database/scripts/build-migration.mjs`         | Rebuilds the migration from the two files above                  |
| `packages/database/prisma/seed.ts`                     | Development reference data (no users; PHASE 03)                  |

Commands:

```bash
pnpm run db:validate     # prisma validate (no database connection needed)
pnpm run db:generate     # regenerate the Prisma client from the schema
pnpm run db:migrate      # apply migrations to a development database
pnpm run db:deploy       # apply migrations in a deployment (CI/production)
pnpm run db:seed         # reference data + development accounts (needs SEED_*)
pnpm --filter @deliveryuy/database run migration:build   # rebuild 0001_init
```

Rebuilding `0001_init` is only allowed while it has never been applied to a
persistent database. Afterwards, changes go into a new migration (AGENTS.md
section 96).

What the migration adds beyond the generated DDL:

- functional unique index on `lower(email)` for non-deleted users, so a deleted
  account frees its address;
- partial unique indexes: one default variant per product, one `ACCEPTED`
  assignment per delivery, one default address per user, one platform category
  per slug;
- `CHECK` constraints on coordinates, non-negative stock and amounts,
  `quantity > 0`, `day_of_week`, rollout percentage, commission rate, rating
  range, `HH:mm` opening hours and attempt counters;
- `ON DELETE RESTRICT` from `order_timeline` to `orders`: the timeline is legal
  history and must survive the order.

Seeding rules:

- refuses to run when `APP_ENV` or `NODE_ENV` is `production`;
- country, currency and timezone come from `DEFAULT_COUNTRY`,
  `DEFAULT_CURRENCY` and `DEFAULT_TIMEZONE`; the city name comes from
  `SEED_CITY_NAME`. Nothing is hardcoded to one city (AGENTS.md section 45);
- zone coordinates and the 15% commission are development placeholders;
- every write is idempotent: a second run neither duplicates a row nor rewrites an
  existing password hash, which would silently invalidate the credentials in use.

### Development accounts

One account per role family is created so a login can be exercised end to end:
`ADMIN`, `MERCHANT`, `DRIVER` and `CUSTOMER`. The driver account also gets its
`Driver` profile row, which requires the seeded city.

- `SEED_<ROLE>_EMAIL` and `SEED_<ROLE>_PASSWORD` are **required**. There is no
  committed default: an account whose password lives in this repository is one an
  attacker can guess, and the seed would create it on any machine that forgot the
  variable. `.env.example` documents the eight variables.
- passwords are hashed with the same Argon2id implementation the API uses
  (`@deliveryuy/auth`), so a seeded account is a working login rather than a
  fixture that only looks plausible (AGENTS.md section 5).
- accounts are created `ACTIVE` with `emailVerifiedAt` set, so they can sign in
  even when `REQUIRE_EMAIL_VERIFICATION=true`; the driver stays
  `PENDING_REVIEW` because driver approval is PHASE 10.
- `packages/database/scripts/assert-seeded-users.mjs` verifies what the seed
  claims: exactly one account per family, an Argon2id digest in every
  `password_hash`, the expected role, and an unchanged digest across two runs.