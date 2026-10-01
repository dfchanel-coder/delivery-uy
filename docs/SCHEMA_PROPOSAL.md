# DeliveryUY Prisma Model Proposal

Status: **APPLIED in PHASE 02** as `packages/database/prisma/schema.prisma` +
migration `0001_init` (see ADR-019 for how it is verified). This document stays
as the design rationale and the record of what changed while applying it.

Changes applied while implementing this proposal:

1. **Core scope only.** The extension groups in section 1 (cart, ledger and
   settlements, promotions, support and disputes, ratings, billing) are still
   future migrations, so `Commission`/`Settlement`/`DriverEarning` follow the
   ledger in PHASE 15 while `CommissionRule` (configuration) is in Core. This
   resolves the older `ROADMAP.MD` list, which named the ledger tables as PHASE 02
   entities; the split in section 1 is the more precise statement and wins.
2. **Explicit mapping.** Every table and column is mapped with `@@map`/`@map`
   (section 2 asked for it; the sample models did not show it). A Prisma rename
   therefore can never rename a database column silently.
3. **`countries` table.** `Country` had no `@@map`; it is now `countries` for
   consistency with the plural convention.
4. **`order_timeline` restricts deletion.** Its relation to `orders` is
   `ON DELETE RESTRICT`, because the timeline is legal history.
5. **Extra constraints.** Beyond section 4: non-negative money on orders,
   payments and order items; `refunded_amount <= paid_amount`; rating range;
   commission rate range; `HH:mm` opening hours; attempt counters. The ledger
   balance trigger of section 4 is intentionally **not** created here: it guards
   tables that do not exist yet and arrives with the PHASE 15 migration.

Derived from `docs/ERD.md`. Governing decisions: `ADR-008` (money),
`ADR-009` (ids, timestamps, soft delete), `ADR-010` (delivery code),
`ADR-011` (idempotency), `ADR-015` (dispatch).

This document fixes the naming, typing and constraint conventions so that
PHASE 02 can generate the real `packages/database/prisma/schema.prisma`
mechanically, and so that raw SQL requirements are known in advance.

---

## 1. Scope split

Migration `0001_init` (PHASE 02) creates the **Core** set only:

identity & access, geography, merchant, catalog, driver, order, dispatch &
delivery, payments, platform operations.

Extensions are added by later migrations, keeping each phase shippable:

| Extension group                | Tables                                                                | Phase |
| ------------------------------ | --------------------------------------------------------------------- | ----- |
| Cart                           | `Cart`, `CartItem`                                                    | 08    |
| Financial ledger & settlements | `Commission`, `LedgerAccount`, `JournalEntry`, `LedgerEntry`, `DriverEarning`, `Settlement`, `SettlementItem` | 15 |
| Promotions                     | `Promotion`, `PromotionRedemption`                                    | 08/09 |
| Support & disputes             | `SupportTicket`, `SupportMessage`, `Dispute`                          | 18    |
| Ratings                        | `Rating`                                                              | 12    |
| Billing                        | `BillingDocument`                                                     | 16    |

---

## 2. Naming and mapping conventions

| Concern          | Rule                                                                |
| ---------------- | ------------------------------------------------------------------- |
| Table names       | Prisma `PascalCase` model mapped with `@@map("snake_case")`           |
| Field names       | `camelCase` in Prisma, `@map("snake_case")` to columns               |
| Primary key       | `id String @id @default(uuid()) @db.Uuid`                           |
| Timestamps       | `DateTime @db.Timestamptz(3)`, named `createdAt`, `updatedAt`, `*At` |
| Money            | `Decimal @db.Decimal(14, 2)` + `currency String @db.Char(3)`         |
| Rates            | `Decimal @db.Decimal(7, 4)`                                         |
| Coordinates       | `Decimal @db.Decimal(9, 6)` + raw SQL `CHECK` on ranges             |
| Time of day      | `String` validated as `HH:mm` / `HH:mm:ss` (Prisma has no time type) |
| Phone            | `String @db.VarChar(20)` E.164, unique when present                  |
| Email            | `String @db.VarChar(255)`, stored lower-cased, functional unique index |
| IP address       | `String @db.VarChar(45)` (IPv6-safe)                                |
| JSON             | `Json @db.JsonB`                                                    |
| Enums            | Prisma enums, mapped to Postgres `CREATE TYPE`; **new values require a migration** |
| Soft delete      | `deletedAt DateTime? @db.Timestamptz(3)`                            |
| Append-only      | no `updatedAt`, no `deletedAt`                                      |

Soft-delete filtering is centralised in `packages/database`
(`notDeleted` helper, extension clients per model). Services must not repeat
`where: { deletedAt: null }` by hand.

---

## 3. Proposed Core schema

```prisma
// packages/database/prisma/schema.prisma (proposal)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

enum AppRole {
  CUSTOMER
  MERCHANT
  DRIVER
  ADMIN
  SUPER_ADMIN
  SUPPORT
  FINANCE
}

enum UserStatus {
  PENDING_VERIFICATION
  ACTIVE
  SUSPENDED
  DISABLED
}

enum MerchantStatus {
  PENDING_REVIEW
  ACTIVE
  REJECTED
  SUSPENDED
  DISABLED
}

enum MerchantMemberRole {
  OWNER
  MANAGER
  CASHIER
  STAFF
}

enum DriverStatus {
  PENDING_REVIEW
  APPROVED
  REJECTED
  SUSPENDED
  DISABLED
}

enum DriverAvailability {
  OFFLINE
  ONLINE
  BUSY
  PAUSED
}

enum VehicleType {
  FOOT
  BICYCLE
  MOTORCYCLE
  CAR
  VAN
}

enum ReviewStatus {
  PENDING
  APPROVED
  REJECTED
}

enum DriverDocumentType {
  IDENTITY
  LICENSE
  VEHICLE_REGISTRATION
  INSURANCE
  TAX_ID
  CERTIFICATE
}

enum ZoneKind {
  POLYGON
  RADIUS
  POSTAL
  NEIGHBORHOOD
}

enum OrderStatus {
  CREATED
  PAYMENT_PENDING
  PAID
  REJECTED
  ACCEPTED
  PREPARING
  READY
  DRIVER_SEARCHING
  DRIVER_ASSIGNED
  DRIVER_ARRIVING
  PICKED_UP
  IN_TRANSIT
  ARRIVED
  DELIVERED
  CANCELLED
  REFUNDED
  DISPUTED
}

enum ActorType {
  SYSTEM
  CUSTOMER
  MERCHANT
  DRIVER
  ADMIN
  WEBHOOK
  JOB
}

enum DeliveryStatus {
  PENDING
  SEARCHING
  ASSIGNED
  ARRIVED_AT_PICKUP
  PICKED_UP
  IN_TRANSIT
  ARRIVED
  COMPLETED
  CANCELLED
  EXCEPTION
}

enum AssignmentStatus {
  OFFERED
  ACCEPTED
  REJECTED
  EXPIRED
  CANCELLED
}

enum PaymentMethod {
  ONLINE_CARD
  WALLET
  CASH
  TRANSFER
}

enum PaymentStatus {
  PENDING
  AUTHORIZED
  APPROVED
  FAILED
  REJECTED
  CANCELLED
  REFUNDED
  PARTIALLY_REFUNDED
  EXPIRED
}

enum RefundStatus {
  PENDING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum WebhookProcessingStatus {
  RECEIVED
  PROCESSED
  FAILED
  IGNORED
}

enum CommissionScope {
  GLOBAL
  CITY
  MERCHANT_CATEGORY
  MERCHANT
  CAMPAIGN
}

enum IdempotencyStatus {
  IN_PROGRESS
  COMPLETED
  FAILED
}

enum OutboxStatus {
  PENDING
  PUBLISHED
  FAILED
}

enum NotificationChannel {
  PUSH
  EMAIL
  SMS
  WHATSAPP
}

enum NotificationStatus {
  PENDING
  SENT
  FAILED
}

enum FlagScope {
  GLOBAL
  CITY
  MERCHANT
  USER
}

enum RiskSeverity {
  LOW
  MEDIUM
  HIGH
}

enum VerificationTokenType {
  EMAIL_VERIFY
  EMAIL_CHANGE
  PHONE_VERIFY
  PASSWORD_RESET
}

// ---------------------------------------------------------------------------
// Identity and access
// ---------------------------------------------------------------------------

model User {
  id                  String     @id @default(uuid()) @db.Uuid
  email               String     @db.VarChar(255)
  phoneE164           String?    @db.VarChar(20)
  passwordHash        String     @db.Text
  status              UserStatus @default(PENDING_VERIFICATION)
  emailVerifiedAt     DateTime?  @db.Timestamptz(3)
  phoneVerifiedAt     DateTime?  @db.Timestamptz(3)
  failedLoginAttempts Int        @default(0)
  lockedUntil         DateTime?  @db.Timestamptz(3)
  lastLoginAt         DateTime?  @db.Timestamptz(3)
  locale              String     @default("es") @db.VarChar(10)
  mustChangePassword  Boolean    @default(false)
  deletedAt           DateTime?  @db.Timestamptz(3)
  createdAt           DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime   @updatedAt @db.Timestamptz(3)

  roles                UserRole[]
  sessions             Session[]
  passwordResetTokens  PasswordResetToken[]
  verificationTokens   VerificationToken[]
  customerProfile      CustomerProfile?
  addresses            Address[]
  favorites            Favorite[]
  ownedMerchants       Merchant[]     @relation("MerchantOwner")
  merchantMemberships  MerchantMember[]
  driverProfile        Driver?
  auditLogs            AuditLog[]
  notifications        Notification[]
  deviceSubscriptions  DeviceSubscription[]
  idempotencyKeys      IdempotencyKey[]
  orders               Order[]
  // SupportTicket.requestedUserId and Dispute.openedByUserId are added in the
  // PHASE 18 extension migration together with their tables.

  @@index([status])
  @@index([deletedAt])
  @@map("users")
}

model UserRole {
  userId    String   @db.Uuid
  role      AppRole
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, role])
  @@index([role])
  @@map("user_roles")
}

model Session {
  id               String    @id @default(uuid()) @db.Uuid
  userId           String    @db.Uuid
  familyId         String    @db.Uuid
  replacedById     String?   @db.Uuid
  refreshTokenHash String    @db.Char(64)
  userAgent        String?   @db.VarChar(512)
  ipAddress        String?   @db.VarChar(45)
  expiresAt        DateTime  @db.Timestamptz(3)
  revokedAt        DateTime? @db.Timestamptz(3)
  revokedReason    String?   @db.VarChar(120)
  rotatedAt        DateTime? @db.Timestamptz(3)
  lastUsedAt       DateTime? @db.Timestamptz(3)
  createdAt        DateTime  @default(now()) @db.Timestamptz(3)
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
  @@index([expiresAt])
  @@unique([refreshTokenHash])
  @@map("sessions")
}

model PasswordResetToken {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid
  tokenHash  String    @db.Char(64)
  requestedIp String?  @db.VarChar(45)
  expiresAt  DateTime  @db.Timestamptz(3)
  usedAt     DateTime? @db.Timestamptz(3)
  createdAt  DateTime  @default(now()) @db.Timestamptz(3)
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@unique([tokenHash])
  @@map("password_reset_tokens")
}

model VerificationToken {
  id          String                @id @default(uuid()) @db.Uuid
  userId      String                @db.Uuid
  type        VerificationTokenType
  tokenHash   String                @db.Char(64)
  destination String                @db.VarChar(255)
  expiresAt   DateTime              @db.Timestamptz(3)
  usedAt      DateTime?             @db.Timestamptz(3)
  createdAt   DateTime              @default(now()) @db.Timestamptz(3)
  user        User                  @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, type])
  @@unique([tokenHash])
  @@map("verification_tokens")
}

model CustomerProfile {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @unique @db.Uuid
  firstName String   @db.VarChar(80)
  lastName  String   @db.VarChar(80)
  photoUrl  String?  @db.VarChar(512)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("customer_profiles")
}

model Address {
  id            String    @id @default(uuid()) @db.Uuid
  userId        String    @db.Uuid
  cityId        String    @db.Uuid
  zoneId        String?   @db.Uuid
  label         String    @db.VarChar(60)
  recipientName String    @db.VarChar(160)
  street        String    @db.VarChar(160)
  streetNumber  String    @db.VarChar(20)
  apartment     String?   @db.VarChar(80)
  latitude      Decimal   @db.Decimal(9, 6)
  longitude     Decimal   @db.Decimal(9, 6)
  instructions  String?   @db.VarChar(500)
  isDefault     Boolean   @default(false)
  deletedAt     DateTime? @db.Timestamptz(3)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(3)
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  city          City      @relation(fields: [cityId], references: [id])
  zone          DeliveryZone? @relation(fields: [zoneId], references: [id])

  @@index([userId, deletedAt])
  @@index([cityId])
  @@index([zoneId])
  @@map("addresses")
}

model Favorite {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  merchantId String   @db.Uuid
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  merchant   Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@unique([userId, merchantId])
  @@map("favorites")
}

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

model Country {
  code             String @id @db.Char(3)
  name             String @db.VarChar(120)
  defaultCurrency  String @db.Char(3)
  timezone         String @db.VarChar(64)
  enabled          Boolean @default(true)
  cities           City[]
}

model City {
  id                String    @id @default(uuid()) @db.Uuid
  countryCode       String    @db.Char(3)
  name              String    @db.VarChar(120)
  departmentOrState String?   @db.VarChar(120)
  timezone          String    @db.VarChar(64)
  currency          String    @db.Char(3)
  isDefault         Boolean   @default(false)
  enabled           Boolean   @default(true)
  country           Country   @relation(fields: [countryCode], references: [code])
  zones             DeliveryZone[]
  addresses         Address[]
  merchants         Merchant[]
  drivers           Driver[]
  orders            Order[]

  @@unique([countryCode, name])
  @@index([enabled])
  @@map("cities")
}

model DeliveryZone {
  id                 String    @id @default(uuid()) @db.Uuid
  cityId             String    @db.Uuid
  name               String    @db.VarChar(120)
  description        String?   @db.VarChar(500)
  kind               ZoneKind
  geometry           Json?     @db.JsonB
  centerLatitude     Decimal?  @db.Decimal(9, 6)
  centerLongitude    Decimal?  @db.Decimal(9, 6)
  radiusMeters       Decimal?  @db.Decimal(10, 2)
  baseFee            Decimal   @default(0) @db.Decimal(14, 2)
  distanceFeePerKm   Decimal   @default(0) @db.Decimal(14, 2)
  surcharge          Decimal   @default(0) @db.Decimal(14, 2)
  minOrderAmount     Decimal   @default(0) @db.Decimal(14, 2)
  maxRadiusMeters    Decimal?  @db.Decimal(10, 2)
  priority           Int       @default(0)
  enabled            Boolean   @default(true)
  validFrom          DateTime? @db.Timestamptz(3)
  validTo            DateTime? @db.Timestamptz(3)
  createdAt          DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime  @updatedAt @db.Timestamptz(3)
  city               City             @relation(fields: [cityId], references: [id])
  addresses          Address[]
  orders             Order[]

  @@index([cityId, enabled])
  @@index([cityId, priority])
  @@map("delivery_zones")
}

// ---------------------------------------------------------------------------
// Merchant
// ---------------------------------------------------------------------------

model Merchant {
  id                     String         @id @default(uuid()) @db.Uuid
  ownerUserId            String         @db.Uuid
  cityId                 String         @db.Uuid
  commissionRuleId       String?        @db.Uuid
  tradeName              String         @db.VarChar(160)
  legalName              String         @db.VarChar(200)
  rut                    String         @db.VarChar(32)
  rutNormalized          String         @db.VarChar(32)
  description            String?        @db.VarChar(2000)
  status                 MerchantStatus @default(PENDING_REVIEW)
  phoneE164              String         @db.VarChar(20)
  email                  String         @db.VarChar(255)
  addressLine            String         @db.VarChar(255)
  latitude               Decimal        @db.Decimal(9, 6)
  longitude              Decimal        @db.Decimal(9, 6)
  timezone               String         @db.VarChar(64)
  acceptingOrders        Boolean        @default(false)
  temporarilyClosedUntil DateTime?      @db.Timestamptz(3)
  ratingAverage          Decimal        @default(0) @db.Decimal(3, 2)
  ratingCount            Int            @default(0)
  approvedAt             DateTime?      @db.Timestamptz(3)
  approvedByUserId       String?        @db.Uuid
  rejectionReason        String?        @db.VarChar(500)
  deletedAt              DateTime?      @db.Timestamptz(3)
  createdAt              DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt              DateTime       @updatedAt @db.Timestamptz(3)
  owner                  User           @relation("MerchantOwner", fields: [ownerUserId], references: [id])
  city                   City           @relation(fields: [cityId], references: [id])
  commissionRule         CommissionRule? @relation(fields: [commissionRuleId], references: [id])
  members                MerchantMember[]
  schedules              MerchantSchedule[]
  closures               MerchantClosure[]
  products               Product[]
  categories             Category[]
  orders                 Order[]
  favorites              Favorite[]

  @@unique([rutNormalized])
  @@index([cityId, status])
  @@index([ownerUserId])
  @@index([status, acceptingOrders])
  @@index([deletedAt])
  @@map("merchants")
}

model MerchantMember {
  id         String             @id @default(uuid()) @db.Uuid
  merchantId String             @db.Uuid
  userId     String             @db.Uuid
  role       MerchantMemberRole
  createdAt  DateTime           @default(now()) @db.Timestamptz(3)
  merchant   Merchant           @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([merchantId, userId])
  @@index([userId])
  @@map("merchant_members")
}

model MerchantSchedule {
  id         String    @id @default(uuid()) @db.Uuid
  merchantId String    @db.Uuid
  dayOfWeek  Int
  openTime   String    @db.VarChar(5)
  closeTime  String    @db.VarChar(5)
  isOpen     Boolean   @default(true)
  breakStart String?   @db.VarChar(5)
  breakEnd   String?   @db.VarChar(5)
  validFrom  DateTime? @db.Timestamptz(3)
  validTo    DateTime? @db.Timestamptz(3)
  merchant   Merchant  @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@unique([merchantId, dayOfWeek])
  @@map("merchant_schedules")
}

model MerchantClosure {
  id              String   @id @default(uuid()) @db.Uuid
  merchantId      String   @db.Uuid
  startsAt        DateTime @db.Timestamptz(3)
  endsAt          DateTime @db.Timestamptz(3)
  reason          String?  @db.VarChar(255)
  createdByUserId String?  @db.Uuid
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  merchant        Merchant @relation(fields: [merchantId], references: [id], onDelete: Cascade)

  @@index([merchantId, startsAt])
  @@map("merchant_closures")
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

model Category {
  id         String    @id @default(uuid()) @db.Uuid
  merchantId String?   @db.Uuid
  parentId   String?   @db.Uuid
  name       String    @db.VarChar(120)
  slug       String    @db.VarChar(160)
  enabled    Boolean   @default(true)
  sortOrder  Int       @default(0)
  createdAt  DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime  @updatedAt @db.Timestamptz(3)
  merchant   Merchant? @relation(fields: [merchantId], references: [id], onDelete: Cascade)
  parent     Category? @relation("CategoryTree", fields: [parentId], references: [id])
  children   Category[] @relation("CategoryTree")
  products   Product[]

  @@unique([merchantId, slug])
  @@index([parentId])
  @@map("categories")
}

model Product {
  id                  String    @id @default(uuid()) @db.Uuid
  merchantId          String    @db.Uuid
  categoryId          String?   @db.Uuid
  name                String    @db.VarChar(200)
  slug                String    @db.VarChar(220)
  description         String?   @db.Text
  basePrice           Decimal   @db.Decimal(14, 2)
  currency            String    @db.Char(3)
  stockManaged        Boolean   @default(false)
  stock               Int       @default(0)
  lowStockThreshold   Int       @default(0)
  preparationMinutes  Int       @default(15)
  enabled             Boolean   @default(true)
  sortOrder           Int       @default(0)
  deletedAt           DateTime? @db.Timestamptz(3)
  createdAt           DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime  @updatedAt @db.Timestamptz(3)
  merchant            Merchant  @relation(fields: [merchantId], references: [id])
  category            Category? @relation(fields: [categoryId], references: [id])
  images              ProductImage[]
  variants            ProductVariant[]
  addons              ProductAddon[]
  orderItems          OrderItem[]

  @@unique([merchantId, slug])
  @@index([merchantId, enabled])
  @@index([categoryId, enabled])
  @@index([deletedAt])
  @@map("products")
}

model ProductImage {
  id         String   @id @default(uuid()) @db.Uuid
  productId  String   @db.Uuid
  storageKey String   @db.VarChar(400)
  altText    String?  @db.VarChar(200)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  product    Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, sortOrder])
  @@map("product_images")
}

model ProductVariant {
  id           String   @id @default(uuid()) @db.Uuid
  productId    String   @db.Uuid
  name         String   @db.VarChar(120)
  priceDelta   Decimal  @default(0) @db.Decimal(14, 2)
  stockManaged Boolean  @default(false)
  stock        Int      @default(0)
  isDefault    Boolean  @default(false)
  enabled      Boolean  @default(true)
  sortOrder    Int      @default(0)
  createdAt    DateTime @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @db.Timestamptz(3)
  product      Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  orderItems   OrderItem[]

  @@unique([productId, name])
  @@index([productId, enabled])
  @@map("product_variants")
}

model ProductAddon {
  id          String   @id @default(uuid()) @db.Uuid
  productId   String   @db.Uuid
  name        String   @db.VarChar(120)
  price       Decimal  @default(0) @db.Decimal(14, 2)
  maxQuantity Int      @default(1)
  enabled     Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  product     Product  @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, name])
  @@index([productId, enabled])
  @@map("product_addons")
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

model Driver {
  id               String             @id @default(uuid()) @db.Uuid
  userId           String             @unique @db.Uuid
  cityId           String             @db.Uuid
  status           DriverStatus       @default(PENDING_REVIEW)
  availability     DriverAvailability @default(OFFLINE)
  vehicleType      VehicleType        @default(MOTORCYCLE)
  vehicleMake      String?            @db.VarChar(80)
  vehicleModel     String?            @db.VarChar(80)
  vehiclePlate     String?            @db.VarChar(16)
  vehicleColor     String?            @db.VarChar(40)
  vehicleYear      Int?
  operationalModel String?           @db.VarChar(60)
  ratingAverage    Decimal            @default(0) @db.Decimal(3, 2)
  ratingCount      Int                @default(0)
  activeDeliveries Int                @default(0)
  reviewedAt       DateTime?          @db.Timestamptz(3)
  reviewedByUserId String?            @db.Uuid
  rejectionReason  String?            @db.VarChar(500)
  termsAcceptedAt  DateTime?          @db.Timestamptz(3)
  termsVersion     String?            @db.VarChar(40)
  deletedAt        DateTime?          @db.Timestamptz(3)
  createdAt        DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime           @updatedAt @db.Timestamptz(3)
  user             User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  city             City               @relation(fields: [cityId], references: [id])
  documents        DriverDocument[]
  locations        DriverLocation[]
  assignments      DriverAssignment[]
  deliveries       Delivery[]
  orders           Order[]
  codeAttempts     DeliveryCodeAttempt[]

  @@index([cityId, status, availability])
  @@index([availability, activeDeliveries])
  @@index([deletedAt])
  @@map("drivers")
}

model DriverDocument {
  id               String             @id @default(uuid()) @db.Uuid
  driverId         String             @db.Uuid
  type             DriverDocumentType
  storageKey       String             @db.VarChar(400)
  status           ReviewStatus       @default(PENDING)
  expiresAt        DateTime?          @db.Timestamptz(3)
  reviewedAt       DateTime?          @db.Timestamptz(3)
  reviewedByUserId String?            @db.Uuid
  rejectionReason  String?            @db.VarChar(500)
  createdAt        DateTime           @default(now()) @db.Timestamptz(3)
  driver           Driver             @relation(fields: [driverId], references: [id], onDelete: Cascade)

  @@index([driverId, type])
  @@index([status])
  @@map("driver_documents")
}

model DriverLocation {
  id             BigInt   @id @default(autoincrement())
  driverId       String   @db.Uuid
  latitude       Decimal  @db.Decimal(9, 6)
  longitude      Decimal  @db.Decimal(9, 6)
  accuracyMeters Decimal? @db.Decimal(8, 2)
  speedKph       Decimal? @db.Decimal(6, 2)
  heading        Decimal? @db.Decimal(6, 2)
  source         String   @default("app") @db.VarChar(20)
  recordedAt     DateTime @default(now()) @db.Timestamptz(3)
  driver         Driver   @relation(fields: [driverId], references: [id], onDelete: Cascade)

  @@index([driverId, recordedAt(sort: Desc)])
  @@map("driver_locations")
}

// ---------------------------------------------------------------------------
// Commission configuration
// ---------------------------------------------------------------------------

model CommissionRule {
  id            String           @id @default(uuid()) @db.Uuid
  scope         CommissionScope
  cityId        String?          @db.Uuid
  merchantId    String?          @db.Uuid
  categoryId    String?          @db.Uuid
  ratePercent   Decimal          @db.Decimal(7, 4)
  flatFee       Decimal          @default(0) @db.Decimal(14, 2)
  effectiveFrom DateTime         @db.Timestamptz(3)
  effectiveTo   DateTime?        @db.Timestamptz(3)
  createdByUserId String?        @db.Uuid
  createdAt     DateTime         @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime         @updatedAt @db.Timestamptz(3)
  merchants     Merchant[]

  @@index([scope, effectiveFrom, effectiveTo])
  @@index([merchantId])
  @@index([cityId])
  @@map("commission_rules")
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

model Order {
  id          String      @id @default(uuid()) @db.Uuid
  code        String      @db.VarChar(12)
  customerId  String      @db.Uuid
  merchantId  String      @db.Uuid
  driverId    String?     @db.Uuid
  cityId      String      @db.Uuid
  zoneId      String?     @db.Uuid
  status      OrderStatus @default(CREATED)
  currency    String      @db.Char(3)

  subtotal          Decimal @db.Decimal(14, 2)
  discountTotal     Decimal @default(0) @db.Decimal(14, 2)
  deliveryFee       Decimal @default(0) @db.Decimal(14, 2)
  serviceFee        Decimal @default(0) @db.Decimal(14, 2)
  taxTotal          Decimal @default(0) @db.Decimal(14, 2)
  total             Decimal @db.Decimal(14, 2)
  refundedTotal     Decimal @default(0) @db.Decimal(14, 2)

  customerNote           String?  @db.VarChar(500)
  merchantNote           String?  @db.VarChar(500)
  rejectionReason        String?  @db.VarChar(500)
  cancelledByUserId      String?  @db.Uuid
  cancellationReason     String?  @db.VarChar(500)
  deliveryAddressSnapshot Json    @db.JsonB
  merchantSnapshot        Json    @db.JsonB
  financialSnapshot       Json?   @db.JsonB
  idempotencyKey         String?  @db.VarChar(120)

  acceptedAt    DateTime? @db.Timestamptz(3)
  readyAt       DateTime? @db.Timestamptz(3)
  pickedUpAt    DateTime? @db.Timestamptz(3)
  deliveredAt   DateTime? @db.Timestamptz(3)
  cancelledAt   DateTime? @db.Timestamptz(3)
  refundedAt    DateTime? @db.Timestamptz(3)
  disputedAt    DateTime? @db.Timestamptz(3)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(3)

  customer     User             @relation(fields: [customerId], references: [id])
  merchant     Merchant         @relation(fields: [merchantId], references: [id])
  driver       Driver?          @relation(fields: [driverId], references: [id])
  city         City             @relation(fields: [cityId], references: [id])
  zone         DeliveryZone?    @relation(fields: [zoneId], references: [id])
  items        OrderItem[]
  timeline     OrderTimeline[]
  delivery     Delivery?
  payments     Payment[]
  refunds      Refund[]

  @@unique([code])
  @@index([customerId, createdAt(sort: Desc)])
  @@index([merchantId, status, createdAt(sort: Desc)])
  @@index([driverId, createdAt(sort: Desc)])
  @@index([cityId, createdAt(sort: Desc)])
  @@index([status])
  @@map("orders")
}

model OrderItem {
  id                String  @id @default(uuid()) @db.Uuid
  orderId           String  @db.Uuid
  productId         String? @db.Uuid
  productVariantId  String? @db.Uuid
  productNameSnapshot String @db.VarChar(200)
  variantSnapshot   Json?   @db.JsonB
  addonsSnapshot    Json?   @db.JsonB
  quantity          Int
  unitPrice         Decimal @db.Decimal(14, 2)
  addonsTotal       Decimal @default(0) @db.Decimal(14, 2)
  discountAmount    Decimal @default(0) @db.Decimal(14, 2)
  taxAmount         Decimal @default(0) @db.Decimal(14, 2)
  lineTotal         Decimal @db.Decimal(14, 2)
  notes             String? @db.VarChar(300)
  order             Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  product           Product? @relation(fields: [productId], references: [id])
  productVariant    ProductVariant? @relation(fields: [productVariantId], references: [id])

  @@index([orderId])
  @@index([productId])
  @@map("order_items")
}

model OrderTimeline {
  id            String       @id @default(uuid()) @db.Uuid
  orderId       String       @db.Uuid
  fromStatus    OrderStatus?
  toStatus      OrderStatus
  actorType     ActorType
  actorUserId   String?      @db.Uuid
  actorRole     AppRole?
  metadata      Json?        @db.JsonB
  correlationId String?      @db.Uuid
  createdAt     DateTime     @default(now()) @db.Timestamptz(3)
  order         Order        @relation(fields: [orderId], references: [id], onDelete: Cascade)

  @@index([orderId, createdAt])
  @@map("order_timeline")
}

// ---------------------------------------------------------------------------
// Dispatch and delivery
// ---------------------------------------------------------------------------

model Delivery {
  id                      String         @id @default(uuid()) @db.Uuid
  orderId                 String         @unique @db.Uuid
  driverId                String?        @db.Uuid
  status                  DeliveryStatus @default(PENDING)
  pickupLatitude          Decimal        @db.Decimal(9, 6)
  pickupLongitude         Decimal        @db.Decimal(9, 6)
  dropoffLatitude         Decimal        @db.Decimal(9, 6)
  dropoffLongitude        Decimal        @db.Decimal(9, 6)
  distanceMeters          Decimal?       @db.Decimal(10, 2)
  estimatedDurationSeconds Int?
  verificationCodeHash    String         @db.VarChar(128)
  verificationCodeSalt    String         @db.VarChar(64)
  verificationCodeExpiresAt DateTime     @db.Timestamptz(3)
  verificationAttempts    Int            @default(0)
  verificationLockedAt    DateTime?      @db.Timestamptz(3)
  verifiedAt              DateTime?      @db.Timestamptz(3)
  verifiedByUserId        String?        @db.Uuid
  exceptionReason         String?        @db.VarChar(500)
  exceptionApprovedByUserId String?      @db.Uuid
  createdAt               DateTime       @default(now()) @db.Timestamptz(3)
  updatedAt               DateTime       @updatedAt @db.Timestamptz(3)
  order                   Order          @relation(fields: [orderId], references: [id], onDelete: Cascade)
  driver                  Driver?        @relation(fields: [driverId], references: [id])
  assignments             DriverAssignment[]
  codeAttempts            DeliveryCodeAttempt[]

  @@index([driverId, status])
  @@map("deliveries")
}

model DriverAssignment {
  id            String           @id @default(uuid()) @db.Uuid
  deliveryId    String           @db.Uuid
  driverId      String           @db.Uuid
  status        AssignmentStatus @default(OFFERED)
  sequence      Int
  distanceMeters Decimal?        @db.Decimal(10, 2)
  offeredAt     DateTime         @default(now()) @db.Timestamptz(3)
  expiresAt     DateTime         @db.Timestamptz(3)
  respondedAt   DateTime?        @db.Timestamptz(3)
  responseReason String?         @db.VarChar(200)
  delivery      Delivery         @relation(fields: [deliveryId], references: [id], onDelete: Cascade)
  driver        Driver           @relation(fields: [driverId], references: [id], onDelete: Cascade)

  @@unique([deliveryId, sequence])
  @@index([deliveryId, status])
  @@index([driverId, status])
  @@map("driver_assignments")
}

model DeliveryCodeAttempt {
  id            String   @id @default(uuid()) @db.Uuid
  deliveryId    String   @db.Uuid
  driverId      String   @db.Uuid
  success       Boolean
  ipAddress     String?  @db.VarChar(45)
  correlationId String?  @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  delivery      Delivery @relation(fields: [deliveryId], references: [id], onDelete: Cascade)
  driver        Driver   @relation(fields: [driverId], references: [id])

  @@index([deliveryId, createdAt])
  @@map("delivery_code_attempts")
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

model Payment {
  id                String        @id @default(uuid()) @db.Uuid
  orderId           String        @db.Uuid
  provider          String        @db.VarChar(40)
  providerPaymentId String?       @db.VarChar(160)
  method            PaymentMethod
  status            PaymentStatus @default(PENDING)
  amount            Decimal       @db.Decimal(14, 2)
  paidAmount        Decimal       @default(0) @db.Decimal(14, 2)
  refundedAmount    Decimal       @default(0) @db.Decimal(14, 2)
  currency          String        @db.Char(3)
  metadata          Json?         @db.JsonB
  idempotencyKey    String?       @db.VarChar(120)
  authorizedAt      DateTime?     @db.Timestamptz(3)
  approvedAt        DateTime?     @db.Timestamptz(3)
  createdAt         DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime      @updatedAt @db.Timestamptz(3)
  order             Order         @relation(fields: [orderId], references: [id])
  refunds           Refund[]

  @@unique([provider, providerPaymentId])
  @@index([orderId])
  @@index([status, createdAt(sort: Desc)])
  @@map("payments")
}

model Refund {
  id               String       @id @default(uuid()) @db.Uuid
  paymentId        String       @db.Uuid
  orderId          String       @db.Uuid
  amount           Decimal      @db.Decimal(14, 2)
  currency         String       @db.Char(3)
  reason           String       @db.VarChar(500)
  providerRefundId String?      @db.VarChar(160)
  status           RefundStatus @default(PENDING)
  requestedByUserId String?     @db.Uuid
  idempotencyKey   String?      @db.VarChar(120)
  createdAt        DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime     @updatedAt @db.Timestamptz(3)
  payment          Payment      @relation(fields: [paymentId], references: [id])
  order            Order        @relation(fields: [orderId], references: [id])

  @@index([paymentId])
  @@index([orderId])
  @@index([status])
  @@map("refunds")
}

model PaymentWebhookEvent {
  id              String                  @id @default(uuid()) @db.Uuid
  provider        String                  @db.VarChar(40)
  providerEventId String                  @db.VarChar(160)
  eventType       String                  @db.VarChar(80)
  payload         Json                    @db.JsonB
  signatureValid  Boolean
  status          WebhookProcessingStatus @default(RECEIVED)
  attempts        Int                     @default(0)
  lastError       String?                 @db.VarChar(500)
  receivedAt      DateTime                @default(now()) @db.Timestamptz(3)
  processedAt     DateTime?               @db.Timestamptz(3)

  @@unique([provider, providerEventId])
  @@index([status, receivedAt])
  @@map("payment_webhook_events")
}

// ---------------------------------------------------------------------------
// Platform operations
// ---------------------------------------------------------------------------

model AuditLog {
  id            String   @id @default(uuid()) @db.Uuid
  actorUserId   String?  @db.Uuid
  actorRole     AppRole?
  action        String   @db.VarChar(120)
  entityType    String   @db.VarChar(80)
  entityId      String?  @db.VarChar(64)
  metadata      Json?    @db.JsonB
  ipAddress     String?  @db.VarChar(45)
  userAgent     String?  @db.VarChar(512)
  correlationId String?  @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz(3)
  actorUser     User?    @relation(fields: [actorUserId], references: [id])

  @@index([entityType, entityId, createdAt(sort: Desc)])
  @@index([actorUserId, createdAt(sort: Desc)])
  @@index([action, createdAt(sort: Desc)])
  @@map("audit_logs")
}

model OutboxEvent {
  id            String       @id @default(uuid()) @db.Uuid
  topic         String       @db.VarChar(120)
  aggregateType String       @db.VarChar(80)
  aggregateId   String       @db.VarChar(64)
  payload       Json         @db.JsonB
  status        OutboxStatus @default(PENDING)
  attempts      Int          @default(0)
  availableAt   DateTime     @default(now()) @db.Timestamptz(3)
  publishedAt   DateTime?    @db.Timestamptz(3)
  lastError     String?      @db.VarChar(500)
  createdAt     DateTime     @default(now()) @db.Timestamptz(3)

  @@index([status, availableAt])
  @@index([aggregateType, aggregateId])
  @@map("outbox_events")
}

model IdempotencyKey {
  id             String            @id @default(uuid()) @db.Uuid
  scope          String            @db.VarChar(80)
  key            String            @db.VarChar(120)
  userId         String?           @db.Uuid
  requestHash    String            @db.Char(64)
  status         IdempotencyStatus @default(IN_PROGRESS)
  resourceType   String?           @db.VarChar(80)
  resourceId     String?           @db.VarChar(64)
  responseStatus Int?
  responseBody   Json?             @db.JsonB
  expiresAt      DateTime          @db.Timestamptz(3)
  createdAt      DateTime          @default(now()) @db.Timestamptz(3)
  user           User?             @relation(fields: [userId], references: [id])

  @@unique([scope, key])
  @@index([expiresAt])
  @@map("idempotency_keys")
}

model SystemConfig {
  id              String   @id @default(uuid()) @db.Uuid
  key             String   @unique @db.VarChar(120)
  value           Json     @db.JsonB
  description     String?  @db.VarChar(500)
  updatedByUserId String?  @db.Uuid
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)

  @@map("system_config")
}

model FeatureFlag {
  id                String    @id @default(uuid()) @db.Uuid
  key               String    @unique @db.VarChar(120)
  scope             FlagScope @default(GLOBAL)
  scopeRef          String?   @db.VarChar(64)
  enabled           Boolean   @default(false)
  rolloutPercentage Int       @default(100)
  description       String?   @db.VarChar(500)
  updatedByUserId   String?   @db.Uuid
  updatedAt         DateTime  @updatedAt @db.Timestamptz(3)
  createdAt         DateTime  @default(now()) @db.Timestamptz(3)

  @@map("feature_flags")
}

model RiskEvent {
  id          String       @id @default(uuid()) @db.Uuid
  subjectType String       @db.VarChar(60)
  subjectId   String       @db.VarChar(64)
  type        String       @db.VarChar(80)
  severity    RiskSeverity @default(LOW)
  metadata    Json?        @db.JsonB
  createdAt   DateTime     @default(now()) @db.Timestamptz(3)

  @@index([subjectType, subjectId, createdAt(sort: Desc)])
  @@index([type, createdAt(sort: Desc)])
  @@map("risk_events")
}

model Notification {
  id                String              @id @default(uuid()) @db.Uuid
  userId            String              @db.Uuid
  channel           NotificationChannel
  templateKey       String              @db.VarChar(120)
  payload           Json?               @db.JsonB
  status            NotificationStatus  @default(PENDING)
  providerMessageId String?             @db.VarChar(160)
  attempts          Int                 @default(0)
  sentAt            DateTime?           @db.Timestamptz(3)
  readAt            DateTime?           @db.Timestamptz(3)
  createdAt         DateTime            @default(now()) @db.Timestamptz(3)
  user              User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
  @@index([status, createdAt])
  @@map("notifications")
}

model DeviceSubscription {
  id           String              @id @default(uuid()) @db.Uuid
  userId       String              @db.Uuid
  channel      NotificationChannel
  target       String              @db.VarChar(400)
  isPrimary    Boolean             @default(false)
  verifiedAt   DateTime?           @db.Timestamptz(3)
  lastUsedAt   DateTime?           @db.Timestamptz(3)
  createdAt    DateTime            @default(now()) @db.Timestamptz(3)
  user         User                @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([channel, target])
  @@index([userId, channel])
  @@map("device_subscriptions")
}

model WebhookOutbound {
  id            String    @id @default(uuid()) @db.Uuid
  topic         String    @db.VarChar(120)
  target        String    @db.VarChar(512)
  payload       Json      @db.JsonB
  headers       Json?     @db.JsonB
  status        String    @default("PENDING") @db.VarChar(20)
  attempts      Int       @default(0)
  nextAttemptAt DateTime  @default(now()) @db.Timestamptz(3)
  deliveredAt   DateTime? @db.Timestamptz(3)
  createdAt     DateTime  @default(now()) @db.Timestamptz(3)

  @@index([status, nextAttemptAt])
  @@map("webhook_outbound")
}
```

---

## 4. Required raw SQL in migration `0001_init`

Prisma cannot express these; they are added in the same migration as
hand-written SQL and documented in `DATABASE.md`.

```sql
-- Case-insensitive unique email (non-deleted users only)
CREATE UNIQUE INDEX users_email_lower_uniq
  ON users (lower(email)) WHERE deleted_at IS NULL;

-- Exactly one default variant per product
CREATE UNIQUE INDEX product_variants_one_default
  ON product_variants (product_id) WHERE is_default;

-- Exactly one accepted assignment per delivery
CREATE UNIQUE INDEX driver_assignments_one_accepted
  ON driver_assignments (delivery_id) WHERE status = 'ACCEPTED';

-- Platform-level category slug uniqueness (merchant_id IS NULL)
CREATE UNIQUE INDEX categories_platform_slug_uniq
  ON categories (slug) WHERE merchant_id IS NULL;

-- One default address per user
CREATE UNIQUE INDEX addresses_one_default
  ON addresses (user_id) WHERE is_default AND deleted_at IS NULL;

-- Coordinate and integrity checks
ALTER TABLE addresses
  ADD CONSTRAINT addresses_latitude_range  CHECK (latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT addresses_longitude_range CHECK (longitude BETWEEN -180 AND 180);
ALTER TABLE merchants
  ADD CONSTRAINT merchants_latitude_range  CHECK (latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT merchants_longitude_range CHECK (longitude BETWEEN -180 AND 180);
ALTER TABLE products
  ADD CONSTRAINT products_stock_non_negative CHECK (stock >= 0);
ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE order_items
  ADD CONSTRAINT order_items_amounts_non_negative
  CHECK (unit_price >= 0 AND addons_total >= 0 AND discount_amount >= 0 AND line_total >= 0);
ALTER TABLE merchant_schedules
  ADD CONSTRAINT merchant_schedules_day_of_week CHECK (day_of_week BETWEEN 0 AND 6);
ALTER TABLE feature_flags
  ADD CONSTRAINT feature_flags_rollout_range CHECK (rollout_percentage BETWEEN 0 AND 100);
ALTER TABLE delivery_zones
  ADD CONSTRAINT delivery_zones_fees_non_negative
  CHECK (base_fee >= 0 AND distance_fee_per_km >= 0 AND surcharge >= 0 AND min_order_amount >= 0);

-- Driver rating consistency (added with the Rating table in PHASE 12)
-- ALTER TABLE drivers ADD CONSTRAINT drivers_rating_range
--   CHECK (rating_average BETWEEN 0 AND 5);

-- Balanced journal entries (added with the ledger in PHASE 15)
CREATE OR REPLACE FUNCTION assert_journal_balanced() RETURNS trigger AS $$
DECLARE
  debits numeric;
  credits numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO debits
    FROM ledger_entries WHERE journal_entry_id = NEW.journal_entry_id AND direction = 'DEBIT';
  SELECT COALESCE(SUM(amount), 0) INTO credits
    FROM ledger_entries WHERE journal_entry_id = NEW.journal_entry_id AND direction = 'CREDIT';
  IF debits <> credits THEN
    RAISE EXCEPTION 'journal entry % is not balanced (debits %, credits %)',
      NEW.journal_entry_id, debits, credits;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
```

Note: the balanced-journal trigger is a `CONSTRAINT TRIGGER ... DEFERRABLE
INITIALLY DEFERRED` created in the PHASE 15 migration together with the ledger
tables, so it is never active before the tables it guards exist.

---

## 5. PostGIS (deferred)

PostGIS is **not** enabled in `0001_init`. It is added by a dedicated migration
when spatial zone editing or radius search is implemented:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE delivery_zones
  ADD COLUMN boundary geometry(Polygon, 4326);
CREATE INDEX delivery_zones_boundary_gix ON delivery_zones USING GIST (boundary);
CREATE INDEX drivers_position_gix ON driver_locations USING GIST (
  ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
);
```

Driver live position stays in Redis (`GEOADD`/`GEOSEARCH`) per ADR-012;
PostGIS is only for administrative analytics and zone containment.

---

## 6. Seed data expectations (PHASE 02)

`prisma/seed.ts` runs only outside production (AGENTS.md section 76) and
creates, idempotently:

1. Countries/cities from `DEFAULT_COUNTRY`, `DEFAULT_CURRENCY`,
   `DEFAULT_TIMEZONE` (no hardcoded Rivera).
2. Users: 1 `SUPER_ADMIN`, 1 `SUPPORT`, 1 `FINANCE`, 1 admin, 2 merchants,
   2 drivers, 2 customers - passwords hashed with the real hashing
   implementation and credentials printed to the console only in
   `development`.
3. 2 active delivery zones with fee rules, categories, products with variants
   and addons.
4. One `GLOBAL` commission rule and one `MERCHANT` override.

Seed must refuse to run when `NODE_ENV=production` or `APP_ENV=production`.

---

## 7. Open questions carried to implementation

| Question                                              | Owner                | Marker                  |
| ----------------------------------------------------- | -------------------- | ----------------------- |
| Legal retention windows for audit/financial tables     | legal counsel        | `LEGAL_REVIEW_REQUIRED` |
| CFE document model and fiscal series numbering          | fiscal provider      | `LEGAL_REVIEW_REQUIRED` |
| Tax inclusion model (prices inclusive of IVA?)          | accountant           | `LEGAL_REVIEW_REQUIRED` |
| Whether `DriverLocation` history is legally required    | legal counsel        | `LEGAL_REVIEW_REQUIRED` |
| Driver operational model taxonomy (ADR-004)             | legal counsel        | `LEGAL_REVIEW_REQUIRED` |