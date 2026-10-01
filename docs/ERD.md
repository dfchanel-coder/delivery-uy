# DeliveryUY Initial ERD (Entity Relationship Design)

Status: PHASE 00 deliverable (architecture)

Source of truth for modelling rules: `DATABASE.md`.
Modelling decisions: `ADR-008` (money), `ADR-009` (ids, timestamps, soft
delete), `ADR-010` (delivery code), `ADR-011` (idempotency),
`ADR-015` (dispatch), `ADR-016` (testing).

The concrete Prisma proposal derived from this document lives in
`docs/SCHEMA_PROPOSAL.md`. If this document and the proposal ever disagree,
this document is the architectural intent and the proposal is the
implementation detail.

---

## Conventions

- Primary key: `id uuid` (database generated).
- Business code columns (`code`, `reference`) are separate from `id`.
- Money: `numeric(14,2)` + `currency char(3)`.
- Rates/percentages: `numeric(7,4)`.
- Timestamps: `timestamptz`, UTC, `*At` suffix.
- Soft delete: `deletedAt timestamptz null`.
- Append-only ledger/audit tables have no `updatedAt`.
- No cascading deletes on financial/audit records; children are removed only
  when the parent itself is transient.

---

## Domain map

| Domain              | Tables                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Identity & access   | `User`, `UserRole`, `Session`, `PasswordResetToken`, `VerificationToken`, `CustomerProfile`, `Address`, `Favorite`                          |
| Geography           | `Country`, `City`, `DeliveryZone`                                                                                                        |
| Merchant            | `Merchant`, `MerchantMember`, `MerchantSchedule`, `MerchantClosure`                                                                       |
| Catalog             | `Category`, `Product`, `ProductImage`, `ProductVariant`, `ProductAddon`                                                                  |
| Driver              | `Driver`, `DriverDocument`, `DriverLocation`                                                                                             |
| Cart                | `Cart`, `CartItem` (PHASE 08)                                                                                                           |
| Order               | `Order`, `OrderItem`, `OrderTimeline`, `OrderStatusHistory` (derived from timeline)                                                       |
| Dispatch & delivery | `Delivery`, `DriverAssignment`, `DeliveryCodeAttempt`                                                                                    |
| Payments            | `Payment`, `Refund`, `PaymentWebhookEvent`                                                                                               |
| Financial ledger    | `CommissionRule`, `Commission`, `LedgerAccount`, `JournalEntry`, `LedgerEntry`, `DriverEarning`, `Settlement`, `SettlementItem`            |
| Billing             | `BillingDocument` (PHASE 16)                                                                                                            |
| Promotions          | `Promotion`, `PromotionRedemption`                                                                                                       |
| Ratings & support   | `Rating`, `SupportTicket`, `SupportMessage`, `Dispute`                                                                                   |
| Platform ops        | `AuditLog`, `OutboxEvent`, `IdempotencyKey`, `SystemConfig`, `FeatureFlag`, `RiskEvent`, `WebhookOutbound`, `Notification`, `DeviceSubscription` |

---

## 1. Identity and access

```mermaid
erDiagram
    User ||--o{ UserRole : has
    User ||--o{ Session : owns
    User ||--o{ PasswordResetToken : requests
    User ||--o{ VerificationToken : requests
    User ||--o| CustomerProfile : extends
    User ||--o{ Address : saves
    User ||--o{ Favorite : marks
    User ||--o{ Merchant : owns
    User ||--o{ MerchantMember : joins
    User ||--o| Driver : registers
    User ||--o{ AuditLog : acts
    User ||--o{ Notification : receives
    User ||--o{ DeviceSubscription : registers

    User {
        uuid id PK
        varchar_255 email UK
        varchar_20 phone_e164 UK
        text password_hash
        user_status status
        timestamptz email_verified_at
        timestamptz phone_verified_at
        int failed_login_attempts
        timestamptz locked_until
        timestamptz last_login_at
        text locale
        timestamptz deleted_at
        timestamptz created_at
        timestamptz updated_at
    }
    UserRole {
        uuid user_id PK,FK
        app_role role PK
        timestamptz created_at
    }
    Session {
        uuid id PK
        uuid user_id FK
        uuid family_id
        uuid replaced_by_id
        text refresh_token_hash
        text user_agent
        inet ip_address
        timestamptz expires_at
        timestamptz revoked_at
        text revoked_reason
        timestamptz rotated_at
        timestamptz created_at
    }
    Address {
        uuid id PK
        uuid user_id FK
        uuid city_id FK
        uuid zone_id FK
        text label
        text recipient_name
        text street
        text street_number
        text apartment
        numeric latitude
        numeric longitude
        text instructions
        bool is_default
        timestamptz deleted_at
    }
    Favorite {
        uuid id PK
        uuid user_id FK
        uuid merchant_id FK
        timestamptz created_at
    }
```

Integrity notes:

- `User.email` is stored lower-cased and is unique among non-deleted users
  (enforced by a functional unique index on `lower(email)`, applied in a raw SQL
  migration - see `docs/SCHEMA_PROPOSAL.md`).
- `Session` rotation: `refresh_token_hash` is a SHA-256 of an opaque random
  token; `family_id` groups a rotation chain; reuse of a rotated token revokes
  the whole family (ADR-002, SECURITY.md).
- `Address.latitude/longitude` are `numeric(9,6)` / `numeric(9,6)` with CHECK
  constraints for valid ranges.

---

## 2. Geography

```mermaid
erDiagram
    Country ||--o{ City : contains
    City ||--o{ DeliveryZone : defines
    City ||--o{ Address : serves
    City ||--o{ Merchant : hosts
    City ||--o{ Driver : operates
    City ||--o{ Order : billed_in

    Country {
        char_3 code PK
        text name
        char_3 default_currency
        text timezone
        bool enabled
    }
    City {
        uuid id PK
        char_3 country_code FK
        text name
        text department_or_state
        text timezone
        char_3 currency
        bool is_default
        bool enabled
    }
    DeliveryZone {
        uuid id PK
        uuid city_id FK
        text name
        text description
        zone_kind kind
        jsonb geometry
        numeric center_latitude
        numeric center_longitude
        numeric radius_meters
        numeric base_fee
        numeric distance_fee_per_km
        numeric surcharge
        numeric min_order_amount
        numeric max_radius_meters
        int priority
        bool enabled
        timestamptz valid_from
        timestamptz valid_to
    }
```

`City` carries timezone and currency so **no city-specific logic is hardcoded**
(AGENTS.md sections 45, 73, 74). PostGIS geometry is added by a later
migration once zone editing requires spatial indexing; `geometry jsonb`
tolerates polygon/radius/neighborhood representations in the meantime.

---

## 3. Merchant

```mermaid
erDiagram
    User ||--o{ Merchant : owns
    City ||--o{ Merchant : located_in
    Merchant ||--o{ MerchantMember : has
    Merchant ||--o{ MerchantSchedule : opens
    Merchant ||--o{ MerchantClosure : pauses
    Merchant ||--o{ Product : sells
    Merchant ||--o{ Order : receives

    Merchant {
        uuid id PK
        uuid owner_user_id FK
        uuid city_id FK
        uuid commission_rule_id FK
        text trade_name
        text legal_name
        text rut
        text rut_normalized
        text description
        merchant_status status
        varchar_20 phone_e164
        varchar_255 email
        text address_line
        numeric latitude
        numeric longitude
        text timezone
        bool accepting_orders
        timestamptz temporarily_closed_until
        numeric rating_average
        int rating_count
        timestamptz approved_at
        uuid approved_by_user_id
        text rejection_reason
        timestamptz deleted_at
    }
    MerchantMember {
        uuid id PK
        uuid merchant_id FK
        uuid user_id FK
        merchant_member_role role
        timestamptz created_at
    }
    MerchantSchedule {
        uuid id PK
        uuid merchant_id FK
        int day_of_week
        time open_time
        time close_time
        bool is_open
        time break_start
        time break_end
        timestamptz valid_from
        timestamptz valid_to
    }
    MerchantClosure {
        uuid id PK
        uuid merchant_id FK
        timestamptz starts_at
        timestamptz ends_at
        text reason
        uuid created_by_user_id
    }
```

---

## 4. Catalog

```mermaid
erDiagram
    Merchant ||--o{ Category : owns
    Category ||--o{ Category : nests
    Category ||--o{ Product : groups
    Product ||--o{ ProductImage : shows
    Product ||--o{ ProductVariant : offers
    Product ||--o{ ProductAddon : offers
    Product ||--o{ OrderItem : referenced_by

    Category {
        uuid id PK
        uuid merchant_id FK
        uuid parent_id FK
        text name
        text slug
        bool enabled
        int sort_order
    }
    Product {
        uuid id PK
        uuid merchant_id FK
        uuid category_id FK
        text name
        text slug
        text description
        numeric base_price
        char_3 currency
        bool stock_managed
        int stock
        int low_stock_threshold
        int preparation_minutes
        bool enabled
        int sort_order
        timestamptz deleted_at
    }
    ProductVariant {
        uuid id PK
        uuid product_id FK
        text name
        numeric price_delta
        bool stock_managed
        int stock
        bool is_default
        bool enabled
        int sort_order
    }
    ProductAddon {
        uuid id PK
        uuid product_id FK
        text name
        numeric price
        int max_quantity
        bool enabled
        int sort_order
    }
    ProductImage {
        uuid id PK
        uuid product_id FK
        text storage_key
        text alt_text
        int sort_order
    }
```

Only `ACTIVE` merchants expose products to customers
(`docs/BUSINESS_RULES.md`). Catalog rows are **never deleted** once ordered;
`OrderItem` snapshots make historical orders independent of these tables.

---

## 5. Driver

```mermaid
erDiagram
    User ||--o| Driver : registers
    City ||--o{ Driver : operates
    Driver ||--o{ DriverDocument : submits
    Driver ||--o{ DriverLocation : reports
    Driver ||--o{ DriverAssignment : receives
    Driver ||--o{ DriverEarning : accrues

    Driver {
        uuid id PK
        uuid user_id FK
        uuid city_id FK
        driver_status status
        driver_availability availability
        vehicle_type vehicle_type
        text vehicle_make
        text vehicle_model
        text vehicle_plate
        text vehicle_color
        int vehicle_year
        text operational_model
        numeric rating_average
        int rating_count
        int active_deliveries
        timestamptz reviewed_at
        uuid reviewed_by_user_id
        text rejection_reason
        timestamptz terms_accepted_at
        text terms_version
        timestamptz deleted_at
    }
    DriverDocument {
        uuid id PK
        uuid driver_id FK
        driver_document_type type
        text storage_key
        review_status status
        timestamptz expires_at
        timestamptz reviewed_at
        uuid reviewed_by_user_id
        text rejection_reason
    }
    DriverLocation {
        bigint id PK
        uuid driver_id FK
        numeric latitude
        numeric longitude
        numeric accuracy_meters
        numeric speed_kph
        timestamptz recorded_at
    }
```

`DriverLocation` is a short-retention operational table (default 24 h, see
ADR-012). Live positions live in Redis. `operational_model` and
`terms_version` exist so ADR-004 (`LEGAL_REVIEW_REQUIRED`) can be resolved by
configuration instead of a schema rewrite.

---

## 6. Cart (PHASE 08)

```mermaid
erDiagram
    User ||--o{ Cart : owns
    Merchant ||--o{ Cart : contains
    Cart ||--o{ CartItem : holds

    Cart {
        uuid id PK
        uuid user_id FK
        uuid merchant_id FK
        timestamptz created_at
        timestamptz updated_at
    }
    CartItem {
        uuid id PK
        uuid cart_id FK
        uuid product_id FK
        uuid product_variant_id FK
        int quantity
        jsonb addons_snapshot
        text notes
    }
```

Invariant: at most **one active cart per user per merchant**
(`docs/BUSINESS_RULES.md`), enforced by a partial unique index.

---

## 7. Order

```mermaid
erDiagram
    User ||--o{ Order : places
    City ||--o{ Order : priced_in
    Merchant ||--o{ Order : fulfills
    Driver ||--o{ Order : delivers
    Order ||--|{ OrderItem : contains
    Order ||--o{ OrderTimeline : records
    Order ||--o| Delivery : fulfilled_by
    Order ||--o{ Payment : paid_with
    Order ||--o{ Commission : charges
    Order ||--o{ DriverEarning : earns
    Order ||--o{ Rating : rated_by
    Order ||--o{ SupportTicket : referenced_by
    Order ||--o{ Dispute : disputed_by
    Order ||--o{ PromotionRedemption : redeems

    Order {
        uuid id PK
        text code UK
        uuid customer_id FK
        uuid merchant_id FK
        uuid driver_id FK
        uuid city_id FK
        uuid zone_id FK
        order_status status
        char_3 currency
        numeric subtotal
        numeric discount_total
        numeric delivery_fee
        numeric service_fee
        numeric tax_total
        numeric total
        numeric refunded_total
        text customer_note
        text merchant_note
        text rejection_reason
        uuid cancelled_by_user_id
        text cancellation_reason
        jsonb delivery_address_snapshot
        jsonb merchant_snapshot
        jsonb financial_snapshot
        text idempotency_key
        timestamptz accepted_at
        timestamptz ready_at
        timestamptz picked_up_at
        timestamptz delivered_at
        timestamptz cancelled_at
    }
    OrderItem {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        uuid product_variant_id FK
        text product_name_snapshot
        jsonb variant_snapshot
        jsonb addons_snapshot
        int quantity
        numeric unit_price
        numeric addons_total
        numeric discount_amount
        numeric tax_amount
        numeric line_total
        text notes
    }
    OrderTimeline {
        uuid id PK
        uuid order_id FK
        order_status from_status
        order_status to_status
        actor_type actor_type
        uuid actor_user_id FK
        app_role actor_role
        jsonb metadata
        uuid correlation_id
        timestamptz created_at
    }
```

Snapshot rule (AGENTS.md sections 87, 88, 89, `DATABASE.md`):
`OrderItem.*_snapshot`, `Order.delivery_address_snapshot`,
`Order.merchant_snapshot` and `Order.financial_snapshot` are immutable after
`Order.createdAt`. Editing a saved address or a product price must never change
an existing order.

---

## 8. Dispatch and delivery

```mermaid
erDiagram
    Order ||--|| Delivery : creates
    Driver ||--o{ Delivery : carries
    Delivery ||--o{ DriverAssignment : offers
    Delivery ||--o{ DeliveryCodeAttempt : records
    Driver ||--o{ DeliveryCodeAttempt : attempts

    Delivery {
        uuid id PK
        uuid order_id FK,UK
        uuid driver_id FK
        delivery_status status
        numeric pickup_latitude
        numeric pickup_longitude
        numeric dropoff_latitude
        numeric dropoff_longitude
        numeric distance_meters
        int estimated_duration_seconds
        text verification_code_hash
        text verification_code_salt
        timestamptz verification_code_expires_at
        int verification_attempts
        timestamptz verification_locked_at
        timestamptz verified_at
        uuid verified_by_user_id
        text exception_reason
        uuid exception_approved_by_user_id
        timestamptz created_at
        timestamptz updated_at
    }
    DriverAssignment {
        uuid id PK
        uuid delivery_id FK
        uuid driver_id FK
        assignment_status status
        int sequence
        numeric distance_meters
        timestamptz offered_at
        timestamptz expires_at
        timestamptz responded_at
        text response_reason
    }
    DeliveryCodeAttempt {
        uuid id PK
        uuid delivery_id FK
        uuid driver_id FK
        bool success
        inet ip_address
        uuid correlation_id
        timestamptz created_at
    }
```

`DriverAssignment` keeps the full offer history (`sequence`, ADR-015,
AGENTS.md section 90). Only one `ACCEPTED` row may exist per delivery, enforced
by a partial unique index.

---

## 9. Payments

```mermaid
erDiagram
    Order ||--o{ Payment : paid_with
    Payment ||--o{ Refund : refunds
    Order ||--o{ PaymentWebhookEvent : receives

    Payment {
        uuid id PK
        uuid order_id FK
        text provider
        text provider_payment_id
        payment_method method
        payment_status status
        numeric amount
        numeric paid_amount
        numeric refunded_amount
        char_3 currency
        jsonb metadata
        text idempotency_key
        timestamptz authorized_at
        timestamptz approved_at
        timestamptz created_at
        timestamptz updated_at
    }
    Refund {
        uuid id PK
        uuid payment_id FK
        uuid order_id FK
        numeric amount
        char_3 currency
        text reason
        text provider_refund_id
        refund_status status
        uuid requested_by_user_id
        text idempotency_key
        timestamptz created_at
        timestamptz updated_at
    }
    PaymentWebhookEvent {
        uuid id PK
        text provider
        text provider_event_id
        text event_type
        jsonb payload
        bool signature_valid
        webhook_processing_status status
        int attempts
        text last_error
        timestamptz received_at
        timestamptz processed_at
    }
```

`unique(provider, provider_event_id)` is the webhook idempotency guard
(ADR-011). `Payment.status` is only ever advanced from verified provider
state, never from a client redirect (AGENTS.md section 18).

---

## 10. Financial ledger, commissions and settlements

```mermaid
erDiagram
    CommissionRule ||--o{ Commission : yields
    CommissionRule ||--o{ Merchant : applies_to
    Order ||--o{ Commission : calculates
    Order ||--o{ JournalEntry : posts
    LedgerAccount ||--o{ LedgerEntry : contains
    JournalEntry ||--|{ LedgerEntry : balanced_by
    Driver ||--o{ DriverEarning : accrues
    Settlement ||--o{ SettlementItem : groups
    Order ||--o{ SettlementItem : settles

    CommissionRule {
        uuid id PK
        commission_scope scope
        uuid city_id FK
        uuid merchant_id FK
        uuid category_id FK
        numeric rate_percent
        numeric flat_fee
        timestamptz effective_from
        timestamptz effective_to
        uuid created_by_user_id
    }
    Commission {
        uuid id PK
        uuid order_id FK
        uuid merchant_id FK
        commission_type type
        numeric rate
        numeric amount
        char_3 currency
        jsonb rule_snapshot
        timestamptz created_at
    }
    LedgerAccount {
        uuid id PK
        ledger_owner_type owner_type
        uuid owner_id
        char_3 currency
        account_kind kind
        timestamptz created_at
    }
    JournalEntry {
        uuid id PK
        text reference_type
        uuid reference_id
        char_3 currency
        timestamptz posted_at
        text memo
        uuid created_by_user_id
        uuid correlation_id
    }
    LedgerEntry {
        uuid id PK
        uuid journal_entry_id FK
        uuid ledger_account_id FK
        ledger_direction direction
        numeric amount
        char_3 currency
    }
    DriverEarning {
        uuid id PK
        uuid order_id FK
        uuid driver_id FK
        numeric amount
        char_3 currency
        earning_status status
        timestamptz available_at
        timestamptz paid_at
    }
    Settlement {
        uuid id PK
        text reference
        settlement_beneficiary beneficiary_type
        uuid beneficiary_id
        char_3 currency
        numeric gross_amount
        numeric commission_amount
        numeric adjustment_amount
        numeric net_amount
        settlement_status status
        timestamptz period_start
        timestamptz period_end
        timestamptz approved_at
        timestamptz paid_at
    }
    SettlementItem {
        uuid id PK
        uuid settlement_id FK
        uuid order_id FK
        numeric gross_amount
        numeric commission_amount
        numeric net_amount
        numeric earning_amount
    }
```

Rules (AGENTS.md sections 20, 21):

- commission rules are resolved by specificity at order time and the resolved
  rule is snapshotted in `Commission.rule_snapshot`;
- a `JournalEntry` must balance: sum(debits) = sum(credits). A PostgreSQL
  deferred constraint trigger enforces this;
- balances are derived from `LedgerEntry`, never stored as mutable counters;
- historical orders are immutable: later commission changes only affect new
  orders.

---

## 11. Promotions, ratings, support

```mermaid
erDiagram
    Promotion ||--o{ PromotionRedemption : consumed_by
    Order ||--o{ PromotionRedemption : applies
    Order ||--o| Rating : produces
    Merchant ||--o{ Rating : scored_by
    Driver ||--o{ Rating : scored_by
    SupportTicket ||--o{ SupportMessage : contains
    SupportTicket }o--o| Order : references

    Promotion {
        uuid id PK
        promotion_scope scope
        uuid merchant_id FK
        uuid city_id FK
        text code
        text name
        promotion_type type
        numeric value
        numeric min_order_amount
        numeric max_discount_amount
        bool applies_to_delivery_fee
        timestamptz starts_at
        timestamptz ends_at
        int usage_limit_total
        int usage_limit_per_customer
        int used_count
        bool enabled
    }
    Rating {
        uuid id PK
        uuid order_id FK,UK
        uuid merchant_id FK
        uuid driver_id FK
        uuid customer_id FK
        int merchant_score
        int delivery_score
        int overall_score
        text comment
        timestamptz created_at
    }
    SupportTicket {
        uuid id PK
        text reference UK
        uuid requester_user_id FK
        app_role requester_role
        ticket_category category
        ticket_status status
        ticket_priority priority
        text subject
        uuid order_id FK
        uuid merchant_id FK
        uuid assigned_to_user_id FK
        timestamptz closed_at
        timestamptz created_at
        timestamptz updated_at
    }
    Dispute {
        uuid id PK
        uuid order_id FK
        uuid opened_by_user_id FK
        text reason
        dispute_status status
        text resolution
        timestamptz resolved_at
        timestamptz created_at
    }
```

`Rating.order_id` is unique: a customer cannot rate the same order twice, and
the service verifies order ownership and `DELIVERED` status
(AGENTS.md section 49).

---

## 12. Platform operations

```mermaid
erDiagram
    User ||--o{ AuditLog : performs
    User ||--o{ Notification : receives
    User ||--o{ DeviceSubscription : registers
    OutboxEvent }o--|| Notification : produces

    AuditLog {
        uuid id PK
        uuid actor_user_id FK
        app_role actor_role
        text action
        text entity_type
        varchar_64 entity_id
        jsonb metadata
        inet ip_address
        text user_agent
        uuid correlation_id
        timestamptz created_at
    }
    OutboxEvent {
        uuid id PK
        text topic
        text aggregate_type
        uuid aggregate_id
        jsonb payload
        outbox_status status
        int attempts
        timestamptz available_at
        timestamptz published_at
        text last_error
        timestamptz created_at
    }
    IdempotencyKey {
        uuid id PK
        text scope
        text key
        uuid user_id FK
        text request_hash
        idempotency_status status
        text resource_type
        uuid resource_id
        int response_status
        jsonb response_body
        timestamptz expires_at
        timestamptz created_at
    }
    SystemConfig {
        uuid id PK
        text key UK
        jsonb value
        text description
        uuid updated_by_user_id
        timestamptz updated_at
    }
    FeatureFlag {
        uuid id PK
        text key UK
        flag_scope scope
        uuid scope_ref
        bool enabled
        int rollout_percentage
        uuid updated_by_user_id
        timestamptz updated_at
    }
    RiskEvent {
        uuid id PK
        text subject_type
        uuid subject_id
        text type
        risk_severity severity
        jsonb metadata
        timestamptz created_at
    }
    Notification {
        uuid id PK
        uuid user_id FK
        notification_channel channel
        text template_key
        jsonb payload
        notification_status status
        text provider_message_id
        int attempts
        timestamptz sent_at
        timestamptz read_at
        timestamptz created_at
    }
    WebhookOutbound {
        uuid id PK
        text topic
        text target
        jsonb payload
        jsonb headers
        webhook_delivery_status status
        int attempts
        timestamptz next_attempt_at
        timestamptz delivered_at
        timestamptz created_at
    }
```

`AuditLog`, `OrderTimeline`, `LedgerEntry`, `PaymentWebhookEvent`,
`DeliveryCodeAttempt` and `RiskEvent` are append-only. `RiskEvent` stores
neutral operational signals only and never asserts fraud
(AGENTS.md section 91).

---

## Cardinality summary

| Parent             | Child              | Cardinality                                | Rule                                                        |
| ------------------ | ------------------ | ------------------------------------------ | ----------------------------------------------------------- |
| User               | Session            | 1:N                                        | hard delete on revoke/expiry                                |
| User               | Merchant           | 1:N                                        | owner retains access even if membership changes             |
| Merchant           | Product            | 1:N                                        | only ACTIVE merchants are customer-visible                  |
| Product            | ProductVariant     | 1:N                                        | exactly one `is_default` variant per product                |
| Order              | OrderItem          | 1:N                                        | snapshot fields immutable                                   |
| Order              | OrderTimeline      | 1:N                                        | append-only, mirrors state machine                          |
| Order              | Delivery           | 1:1                                        | created with the order                                      |
| Delivery           | DriverAssignment   | 1:N                                        | at most one `ACCEPTED`; full offer history kept             |
| Order              | Payment            | 1:N                                        | sum(paid) - sum(refunded) must never exceed `Order.total`   |
| JournalEntry       | LedgerEntry        | 1:N (>=2)                                  | debits = credits per currency                              |
| Order              | Rating             | 1:1                                        | unique(order_id)                                            |
| Settlement         | SettlementItem     | 1:N                                        | items never cross beneficiary or period                    |
| Promotion          | PromotionRedemption| 1:N                                        | usage limits enforced transactionally                       |

---

## Database-enforced integrity (not just application rules)

1. `CHECK` constraints for money precision, coordinate ranges, rating ranges
   (1-5), `day_of_week` (0-6), `quantity > 0`, `attempts >= 0`.
2. `UNIQUE` on `User.email`, `Session.refresh_token_hash`,
   `PaymentWebhookEvent(provider, provider_event_id)`,
   `IdempotencyKey(scope, key)`, `Product(merchant_id, slug)`,
   `Merchant.rut_normalized`, `Rating.order_id`, `Order.code`,
   `Delivery.order_id`, `ProductVariant(product_id, name)`,
   `ProductAddon(product_id, name)`, `Favorite(user_id, merchant_id)`,
   `Driver.user_id`, `CustomerProfile.user_id`.
3. Partial unique indexes: one default variant per product, one `ACCEPTED`
   assignment per delivery, one active cart per user+merchant,
   platform-level category slug uniqueness.
4. `CHECK (quantity > 0)` plus `CHECK (stock >= 0)` for stock-managed items.
5. Deferred constraint trigger enforcing balanced `JournalEntry`.
6. `CHECK` preventing a `User` row from having an `ADMIN` role without a
   non-deleted profile (implemented in application + audit instead of a
   constraint, to avoid schema-level coupling to RBAC).
7. No `ON DELETE CASCADE` from `User`, `Merchant` or `Order` to financial or
   audit tables.

---

## Index plan

| Table                 | Index                                                        | Purpose                                  |
| --------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| User                  | unique(email)                                                | login                                    |
| Session               | (user_id), (family_id), (expires_at)                          | revocation, cleanup                      |
| City / DeliveryZone   | (country_code), (city_id, enabled), (city_id, priority)        | zone resolution                          |
| Merchant              | (city_id, status), (owner_user_id), (status, accepting_orders) | marketplace listing, approval queue      |
| Product               | (merchant_id, category_id, enabled), (merchant_id, slug)       | catalog browsing                        |
| Driver                | (city_id, status, availability)                                | dispatch candidate lookup                |
| DriverLocation        | (driver_id, recorded_at desc)                                 | short-window history                    |
| Order                 | (customer_id, created_at desc), (merchant_id, status, created_at desc), (driver_id, created_at desc), (city_id, created_at desc) | history screens, operations |
| OrderTimeline         | (order_id, created_at)                                        | timeline rendering                      |
| Delivery              | unique(order_id), (driver_id, status)                          | driver job list                          |
| DriverAssignment      | (delivery_id, sequence), (driver_id, status)                   | offer lifecycle                          |
| Payment               | (order_id), unique(provider, provider_payment_id)              | reconciliation                           |
| LedgerEntry           | (ledger_account_id), (journal_entry_id)                        | balance computation                      |
| Settlement            | (beneficiary_type, beneficiary_id, status)                     | payout batches                           |
| Promotion             | (code, enabled), (starts_at, ends_at)                          | promo lookup                             |
| AuditLog              | (entity_type, entity_id, created_at desc), (actor_user_id, created_at desc) | audit investigation   |
| OutboxEvent           | (status, available_at)                                        | worker polling                           |
| IdempotencyKey        | unique(scope, key), (expires_at)                               | replay + cleanup                         |

Cursor pagination for large dynamic datasets uses the `(created_at, id)`
composite ordering so cursors stay stable (AGENTS.md section 55).

---

## Retention

| Data                             | Default retention            | Configurable key           |
| -------------------------------- | ---------------------------- | -------------------------- |
| `DriverLocation`                 | 24 h                         | `GPS_HISTORY_RETENTION`    |
| Live driver position (Redis)     | 120 s TTL                    | `GPS_POSITION_TTL`         |
| `Session` (revoked/expired)      | 30 days after expiry          | `SESSION_RETENTION`        |
| `IdempotencyKey`                 | 7 days (client) / 30 (webhook) | `IDEMPOTENCY_RETENTION`  |
| `OutboxEvent` (published)        | 7 days                       | `OUTBOX_RETENTION`         |
| `AuditLog`, `OrderTimeline`, `LedgerEntry` | per legal requirement | `LEGAL_REVIEW_REQUIRED`    |
| `DriverLocation` history beyond retention | deleted by scheduled job | -                 |

Legal retention windows for financial and audit records are
`LEGAL_REVIEW_REQUIRED` (LEGAL.md).

---

## Open items for later phases

- `BillingDocument` (PHASE 16) - CFE/electronic invoicing, provider neutral.
- `Wallet`, `Tip`, `LoyaltyAccount` - feature-flagged, not designed yet.
- PostGIS geometry column replacing `DeliveryZone.geometry jsonb` once zone
  editing UI exists.
- Partitioning strategy for `Order`, `AuditLog`, `DriverLocation` when volume
  justifies it (evaluate at PHASE 22).