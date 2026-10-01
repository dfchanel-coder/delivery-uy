# DeliveryUY Database Architecture

Status: PHASE 00 finalized

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