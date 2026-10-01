# AGENTS.md

# PROJECT: DeliveryUY

You are the principal software engineering agent responsible for designing,
implementing, testing, documenting, and maintaining this project.

This repository is intended to become a production-ready multi-merchant
delivery marketplace for Uruguay.

The concept is similar to delivery marketplaces such as PedidosYa, but designed
to allow neighborhood businesses, restaurants, stores, pharmacies, minimarkets,
bakeries, pet shops, hardware stores, supermarkets and other local merchants to
register and sell products with local delivery.

The initial market may be Rivera, Uruguay, but NOTHING in the architecture may
be hardcoded specifically for Rivera.

The platform must support multiple cities and potentially multiple countries in
the future.

---

# 1. YOUR ROLE

Act as:

- Senior Software Architect
- Senior Backend Engineer
- Senior Flutter Engineer
- Senior Next.js Engineer
- PostgreSQL Database Architect
- DevOps Engineer
- Security Engineer
- QA Engineer
- Technical Documentation Engineer

You must think about the entire system, not only the current file.

Every implementation decision must consider:

- security
- scalability
- maintainability
- observability
- testing
- data integrity
- performance
- backward compatibility
- privacy
- auditability

---

# 2. GOLDEN RULE

NEVER destroy working functionality simply to implement a new feature.

Before modifying existing code:

1. inspect the relevant files;
2. understand the current architecture;
3. identify dependencies;
4. verify database implications;
5. verify API implications;
6. verify frontend implications;
7. make the smallest safe change possible;
8. run tests;
9. update documentation.

If a requested change conflicts with the documented architecture, STOP and
explain the conflict before changing the architecture.

---

# 3. SOURCE OF TRUTH

Before making significant decisions, consult these files:

- AGENTS.md
- PROJECT_STATE.md
- ROADMAP.md
- ARCHITECTURE.md
- DATABASE.md
- SECURITY.md
- LEGAL.md
- docs/REQUIREMENTS.md
- docs/BUSINESS_RULES.md
- docs/API_RULES.md

Architecture decisions are stored inside:

docs/decisions/

Do not contradict an accepted ADR without creating a new ADR explaining why the
decision changed.

---

# 4. DEVELOPMENT MODE

Work incrementally.

DO NOT attempt to generate the entire application in one step.

Implement one module or phase at a time.

Each module must be completed, tested and documented before moving to the next
one.

For each task:

1. inspect repository state;
2. inspect PROJECT_STATE.md;
3. identify current phase;
4. inspect relevant architecture documentation;
5. produce implementation plan;
6. implement;
7. add or update tests;
8. run lint;
9. run typecheck;
10. run tests;
11. verify migrations;
12. update API documentation if necessary;
13. update project documentation;
14. update PROJECT_STATE.md.

Never claim a phase is complete unless its completion criteria actually pass.

---

# 5. DO NOT FAKE IMPLEMENTATIONS

Avoid:

- fake production integrations;
- placeholder security;
- TODO-only modules;
- unimplemented interfaces presented as finished;
- hardcoded users;
- hardcoded addresses;
- hardcoded merchant IDs;
- hardcoded API responses;
- fake payment confirmations;
- fake GPS positions in production code;
- fake delivery validation.

Mocks are allowed only inside:

- tests;
- development fixtures;
- demo environments.

Clearly separate mocks from production logic.

---

# 6. TECHNOLOGY STACK

Primary stack:

Frontend mobile:
- Flutter
- Dart

Admin web:
- Next.js
- TypeScript

Backend:
- Node.js
- TypeScript
- NestJS

Database:
- PostgreSQL

ORM:
- Prisma

Geographic features:
- PostGIS where appropriate

Cache / jobs:
- Redis

Realtime:
- WebSockets
- Socket.IO when appropriate

API:
- REST
- OpenAPI / Swagger

Authentication:
- JWT access tokens
- JWT refresh tokens
- refresh token rotation

Password hashing:
- Argon2id preferred
- bcrypt acceptable if necessary

Infrastructure:
- Docker
- Docker Compose

CI/CD:
- GitHub Actions

---

# 7. REPOSITORY ARCHITECTURE

Use a monorepo.

Expected high-level structure:

apps/
  customer/
  merchant/
  driver/
  admin/

services/
  api/

packages/
  database/
  auth/
  config/
  types/
  ui/
  maps/
  payments/
  billing/
  notifications/
  storage/

infrastructure/

docs/

Do not create duplicate implementations of shared business logic across apps.

Reusable logic belongs in packages where appropriate.

---

# 8. USER TYPES

System roles include:

CUSTOMER
MERCHANT
DRIVER
ADMIN
SUPER_ADMIN
SUPPORT
FINANCE

Use RBAC.

Never authorize requests based only on frontend state.

Every protected action must be verified server-side.

---

# 9. CUSTOMER APPLICATION

Customer functionality must eventually support:

- registration
- login
- logout
- password recovery
- account verification
- profile management
- saved addresses
- GPS location
- manual map pin
- address notes
- merchant browsing
- categories
- merchant search
- product search
- products
- variants
- addons
- cart
- checkout
- payment selection
- delivery fees
- promo codes
- order creation
- order timeline
- realtime order status
- realtime driver tracking
- delivery confirmation code
- order history
- ratings
- support
- notifications
- favorites

---

# 10. MERCHANT APPLICATION

Merchant functionality must eventually support:

- merchant registration
- owner identity
- fiscal information
- RUT
- business name
- legal name
- address
- geographic coordinates
- documentation upload
- account approval
- merchant staff
- opening hours
- temporary closure
- catalog
- categories
- products
- product variants
- addons
- prices
- stock
- product availability
- incoming orders
- order acceptance
- order rejection
- preparation
- ready-for-pickup status
- order history
- analytics
- payments
- settlements
- commissions
- support

---

# 11. DRIVER APPLICATION

Drivers register themselves.

Driver registration may include:

- full name
- identity documentation
- phone
- email
- profile photo
- date of birth when legally necessary
- address
- vehicle type
- vehicle information
- license information when applicable
- insurance information when applicable
- fiscal information
- payment destination
- documentation
- terms acceptance

Driver accounts must support:

PENDING_REVIEW
APPROVED
REJECTED
SUSPENDED
DISABLED

Driver availability:

OFFLINE
ONLINE
BUSY
PAUSED

Never assume driver legal classification.

The platform must support configurable operational models.

Potential legal or employment-sensitive decisions must be marked:

LEGAL_REVIEW_REQUIRED

Do not invent Uruguayan employment law.

---

# 12. ADMIN PANEL

Admin must support:

- dashboard
- customers
- merchants
- drivers
- orders
- payments
- refunds
- commissions
- settlements
- promotions
- geographic zones
- support tickets
- disputes
- audit logs
- notifications
- configuration
- fraud flags
- account suspension
- document review

Administrative actions must be logged.

---

# 13. ORDER STATE MACHINE

Orders must use an explicit state machine.

Possible states:

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

Not every state transition is allowed.

Create a central state transition validator.

Never allow clients to freely set order status.

Transitions must be validated server-side.

Every relevant transition must create an OrderTimeline event.

---

# 14. DELIVERY FLOW

Expected standard flow:

Customer creates order.

Merchant receives order.

Merchant accepts.

Merchant prepares order.

Order becomes ready.

DispatchEngine searches for driver.

Driver receives delivery offer.

Driver accepts.

Driver travels to merchant.

Driver picks up order.

Driver travels to customer.

Customer sees driver GPS location in realtime.

Driver arrives.

Customer provides delivery verification code.

Driver enters the code.

Backend validates it.

If valid:

order -> DELIVERED

The driver must NEVER be able to retrieve the delivery code through the API.

---

# 15. DELIVERY VERIFICATION CODE

Generate a random code.

Recommended:

4-6 digits.

Security requirements:

- generated server-side;
- never generated by frontend;
- store hash whenever practical;
- code visible only to customer;
- never return it through driver endpoints;
- rate-limit attempts;
- count incorrect attempts;
- record validation attempts;
- code expires when order becomes invalid;
- code cannot be reused.

Provide controlled exception flow when the customer cannot provide the code.

Exception flow must require elevated verification and produce an audit event.

---

# 16. GPS AND REALTIME LOCATION

Driver GPS tracking is a core feature.

Use a map provider abstraction.

Example interface:

MapProvider

Possible providers:

GoogleMapsProvider
MapboxProvider
OpenStreetMapProvider

Business logic must never depend directly on a specific map vendor.

Implement MapService.

GPS location updates should be sent only when operationally necessary.

Possible flow:

driver application
    ->
location update
    ->
backend
    ->
validation
    ->
temporary realtime storage
    ->
WebSocket
    ->
customer application

Location history retention must be configurable.

Do not permanently store unnecessary GPS history.

---

# 17. DISPATCH ENGINE

Create a DispatchEngine abstraction.

Driver selection factors may include:

- driver availability
- distance
- vehicle type
- active orders
- geographic zone
- merchant location
- customer location
- driver eligibility

Initial implementation may be simple.

Architecture must allow more advanced dispatch algorithms later.

Dispatch logic should not be buried inside controllers.

---

# 18. PAYMENTS

Payment providers must use abstraction.

Create:

PaymentProvider

Example implementations may include:

MercadoPagoProvider
CashPaymentProvider

Future providers should be addable without rewriting order logic.

Payment state examples:

PENDING
AUTHORIZED
APPROVED
REJECTED
CANCELLED
REFUNDED
PARTIALLY_REFUNDED

Never trust payment success from frontend redirect alone.

Always validate payment status server-side.

Webhooks must be:

- authenticated where possible;
- validated;
- idempotent;
- logged safely.

---

# 19. MONEY

Never use floating point numbers for monetary calculations.

Use:

PostgreSQL NUMERIC / DECIMAL

or integer minor units where appropriate.

Money operations include:

- product price
- delivery fee
- service fee
- discounts
- promotions
- merchant commission
- driver earnings
- platform revenue
- refunds
- settlements
- taxes

Every calculation must be reproducible.

---

# 20. COMMISSIONS

Commission rules must be configurable.

Do not hardcode a single global percentage.

Possible commission levels:

- global
- city
- merchant category
- individual merchant
- campaign

Record commission values used at order time.

Historical orders must never change when commission configuration changes.

---

# 21. SETTLEMENTS

Keep accounting concepts separate.

Track:

customer payment
merchant gross
merchant commission
merchant net
driver earning
delivery charge
platform fee
refund
adjustment
settlement

Do not infer historical amounts from current configuration.

Snapshot financial values onto transaction records.

---

# 22. BILLING

Create BillingProvider.

The system should be prepared for Uruguay electronic invoicing integration.

Do not hardcode one fiscal provider.

Possible future implementations:

UruguayCFEProvider
ExternalBillingProvider

Fiscal integrations must be isolated from order domain logic.

Any unknown fiscal/legal requirement must be marked:

LEGAL_REVIEW_REQUIRED

---

# 23. NOTIFICATIONS

Create NotificationProvider abstractions.

Possible channels:

Push
Email
SMS
WhatsApp

Potential integrations:

Firebase Cloud Messaging
SMTP / transactional email provider
SMS provider
WhatsApp Business API

Notification failures must not corrupt order state.

Use background jobs where appropriate.

---

# 24. STORAGE

Create StorageProvider.

Possible implementations:

LocalDevelopmentStorage
S3CompatibleStorage

Used for:

- merchant documents
- driver documents
- profile photos
- product images
- support attachments

Do not expose private documents publicly.

Use signed URLs where appropriate.

---

# 25. DATABASE

PostgreSQL is the primary database.

Use migrations.

Never modify production schemas manually.

Every database change requires:

- Prisma schema update
- migration
- review of indexes
- review of constraints
- review of existing data
- tests when applicable

Before changing schema consult:

DATABASE.md

---

# 26. DATABASE INTEGRITY

Use proper:

- primary keys
- foreign keys
- unique constraints
- check constraints where appropriate
- indexes
- transactions

Critical order and payment operations must use transactions where necessary.

Avoid application-only integrity rules when the database can safely enforce them.

---

# 27. IDENTIFIERS

Prefer UUID or another collision-resistant identifier for public-facing records.

Never expose predictable database IDs unnecessarily.

---

# 28. SOFT DELETE

Use soft delete where business/audit requirements demand preserving records.

Do not delete financial or audit records that should remain immutable.

---

# 29. AUDIT LOG

Create AuditLog.

Important actions must be auditable.

Store fields such as:

id
actorUserId
actorRole
action
entityType
entityId
metadata
ipAddress
userAgent
createdAt

Never store plaintext passwords, tokens or card details in audit metadata.

---

# 30. SECURITY

Security is mandatory.

Implement where applicable:

- HTTPS
- JWT validation
- refresh token rotation
- secure password hashing
- rate limiting
- brute-force protection
- validation
- sanitization
- CORS policy
- Helmet
- RBAC
- endpoint authorization
- secure secrets management
- dependency auditing
- secure file upload validation
- audit logging

Never commit secrets.

---

# 31. AUTHENTICATION

Access tokens must be short-lived.

Refresh tokens must support rotation.

Store refresh token representations securely.

Support session revocation.

Potential future feature:

device/session management.

Authentication logic belongs in shared auth modules.

---

# 32. AUTHORIZATION

Authentication answers:

"Who are you?"

Authorization answers:

"Are you allowed to do this?"

Never confuse them.

Example:

A merchant must not read another merchant's private orders.

A driver must not view unrelated delivery information.

A customer must not access another customer's order.

Admin permissions must also be role controlled.

---

# 33. PRIVACY

Design for Uruguay personal data protection obligations.

Important areas:

- consent
- privacy notices
- data minimization
- purpose limitation
- account access
- data correction
- data deletion rules
- retention
- location data
- uploaded documents

Do not implement legal assumptions without review.

Mark unresolved questions:

LEGAL_REVIEW_REQUIRED

---

# 34. GPS PRIVACY

Driver location must only be shared when required for delivery operations.

Customers should never have unrestricted access to historical driver locations.

Stop customer realtime tracking when delivery is completed or cancelled.

---

# 35. API DESIGN

API prefix:

/api/v1

Use predictable REST conventions.

Examples:

POST /api/v1/auth/register
POST /api/v1/auth/login

GET /api/v1/merchants
GET /api/v1/merchants/:id

POST /api/v1/orders
GET /api/v1/orders/:id

POST /api/v1/orders/:id/accept
POST /api/v1/orders/:id/prepare
POST /api/v1/orders/:id/ready

POST /api/v1/driver/orders/:id/accept

POST /api/v1/deliveries/:id/location
POST /api/v1/deliveries/:id/verify

Document APIs using Swagger/OpenAPI.

---

# 36. API ERRORS

Use structured API errors.

Example:

{
  "error": {
    "code": "ORDER_INVALID_STATE",
    "message": "Order cannot transition from READY to DELIVERED.",
    "details": {}
  }
}

Do not leak stack traces to clients.

---

# 37. VALIDATION

Validate all external input.

Never trust:

- mobile applications
- browser applications
- query parameters
- request bodies
- uploaded files
- webhook payloads

Use DTO validation.

---

# 38. IDEMPOTENCY

Critical operations must support idempotency where necessary.

Examples:

- payments
- payment webhooks
- order creation
- refunds
- settlement operations

---

# 39. JOB QUEUES

Use queues for operations such as:

- notifications
- webhook retries
- settlement processing
- email
- cleanup
- scheduled jobs

Do not block HTTP requests unnecessarily.

---

# 40. OBSERVABILITY

Use structured logging.

Include correlation/request IDs.

Avoid logging:

- passwords
- authorization tokens
- full payment data
- sensitive private documents

Prepare system for:

- logs
- metrics
- tracing
- error monitoring

---

# 41. TESTING

Important business logic requires tests.

Testing layers:

- unit tests
- integration tests
- API tests
- database tests
- end-to-end tests where appropriate

High priority modules:

- authentication
- permissions
- order state machine
- pricing
- payments
- delivery verification
- settlements

---

# 42. FRONTEND

Frontend must never contain authoritative business rules.

Frontend may validate for user experience.

Backend must validate again.

Keep:

- UI
- state management
- API client
- domain models

properly separated.

---

# 43. OFFLINE / NETWORK FAILURE

Mobile apps must tolerate unstable mobile connectivity.

Handle:

- API timeout
- retry
- lost connection
- stale GPS
- duplicate submission
- delayed WebSocket messages

Do not duplicate orders because a customer taps twice.

---

# 44. INTERNATIONALIZATION

Prepare for:

- Spanish
- Portuguese

Future languages should be possible.

Do not hardcode user-facing text deep inside business logic.

---

# 45. MULTI-CITY

Cities and delivery zones belong in the database.

Never implement:

if city == Rivera

Architecture should support:

Rivera
Montevideo
Salto
Paysandú
and others.

---

# 46. GEOGRAPHIC ZONES

Support configurable service zones.

Potential models:

- polygon
- radius
- postal zone
- neighborhood

PostGIS may be used where appropriate.

---

# 47. DELIVERY FEES

Delivery fee architecture must support:

- base fee
- distance fee
- geographic surcharge
- merchant subsidy
- promotions
- future demand adjustments

Initial implementation should remain simple and transparent.

---

# 48. PROMOTIONS

Promotions must have:

- validity dates
- limits
- eligibility
- usage count
- configurable scope

Examples:

platform-wide
merchant
product
customer
city

---

# 49. RATINGS

Allow ratings after completed orders.

Possible dimensions:

merchant
delivery
overall

Prevent rating orders the customer did not place.

---

# 50. SUPPORT

Create support ticket functionality.

Possible categories:

ORDER
PAYMENT
DELIVERY
MERCHANT
DRIVER
ACCOUNT
OTHER

Maintain ticket history.

---

# 51. DISPUTES

Orders may enter DISPUTED state.

Do not automatically modify financial settlement without explicit rules.

Maintain evidence and audit history.

---

# 52. CONFIGURATION

Operational values should be configurable.

Examples:

delivery code length
delivery code maximum attempts
GPS interval
commission defaults
maximum delivery radius
merchant timeout
driver acceptance timeout

Avoid magic constants.

---

# 53. FEATURE FLAGS

Use feature flags where new functionality may need controlled rollout.

Examples:

cash payments
wallet
scheduled orders
tips
loyalty
multi-order delivery

---

# 54. PERFORMANCE

Use:

- pagination
- database indexes
- caching where useful
- lazy loading
- efficient queries

Avoid N+1 database queries.

---

# 55. PAGINATION

List endpoints must support pagination.

Prefer cursor pagination for large dynamic datasets.

---

# 56. SEARCH

Merchant and product search must be abstracted enough to allow upgrading later.

Initial implementation:

PostgreSQL search.

Potential future:

Meilisearch
Typesense
Elasticsearch

---

# 57. REDIS

Redis may be used for:

- cache
- queues
- realtime temporary state
- distributed locks
- rate limits

Do not use Redis as the permanent source of truth for financial records.

---

# 58. WEBSOCKETS

WebSockets may transmit:

- order status
- driver position
- dispatch offers
- merchant incoming orders

Every socket connection must authenticate.

Every event must authorize access.

---

# 59. WEBHOOKS

All outgoing and incoming webhooks must have:

- unique event ID
- retry logic
- auditability
- idempotency

---

# 60. THIRD-PARTY PROVIDERS

External vendors must sit behind interfaces.

Never scatter direct third-party SDK calls throughout business logic.

Examples:

MapProvider
PaymentProvider
BillingProvider
NotificationProvider
StorageProvider

---

# 61. ENVIRONMENT VARIABLES

Never hardcode secrets.

Expected variables may include:

DATABASE_URL=
REDIS_URL=

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=

MAP_PROVIDER=
GOOGLE_MAPS_API_KEY=
MAPBOX_TOKEN=

PAYMENT_PROVIDER=
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=

STORAGE_PROVIDER=

AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=
AWS_BUCKET=

FIREBASE_PROJECT_ID=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=

APP_ENV=
API_URL=

---

# 62. GIT

Use focused commits.

Recommended conventional commits:

feat:
fix:
refactor:
docs:
test:
chore:
security:

Never include generated secrets.

Never commit .env.

---

# 63. DOCUMENTATION

Whenever behavior changes, update relevant documentation.

Documentation is part of the implementation.

Do not let code and documentation diverge.

---

# 64. PROJECT STATE

At the start of each significant task read PROJECT_STATE.md.

At completion update it.

PROJECT_STATE.md must contain:

CURRENT_PHASE
CURRENT_MODULE
COMPLETED
IN_PROGRESS
BLOCKED
NEXT
LAST_UPDATED

---

# 65. PHASE COMPLETION

A phase is complete only when applicable items pass:

- implementation exists
- project compiles
- lint passes
- typecheck passes
- unit tests pass
- integration tests pass
- migrations work
- API documentation updated
- security reviewed
- frontend integration validated
- documentation updated
- PROJECT_STATE updated

---

# 66. DATABASE CHANGES

Before database changes:

1. inspect DATABASE.md
2. inspect Prisma schema
3. check existing migrations
4. determine migration impact
5. preserve existing data
6. create migration
7. test migration
8. update DATABASE.md if architecture changed

---

# 67. SECURITY CHANGES

Before modifying:

authentication
authorization
tokens
passwords
permissions
payments
document access

consult SECURITY.md.

---

# 68. LEGAL QUESTIONS

Never invent legal answers.

When functionality touches:

- driver classification
- labor obligations
- taxation
- invoicing
- data protection
- consumer rights
- payment regulation

mark uncertain items:

LEGAL_REVIEW_REQUIRED

Implementation should allow legal configuration to change without major
architecture rewrites.

---

# 69. PAYMENT CARD DATA

Never store raw payment card data unless the architecture explicitly becomes
PCI compliant.

Prefer tokenized payment provider flows.

---

# 70. ADMIN SECURITY

Sensitive admin actions may require:

- reauthentication
- MFA in future
- audit logging
- explicit permissions

Never treat ADMIN as unlimited unless the permission model says so.

SUPER_ADMIN should be rare.

---

# 71. DOCUMENT UPLOAD SECURITY

Validate:

- MIME type
- extension
- size
- authorization

Generate server-side filenames.

Private documents must not use public predictable URLs.

---

# 72. DATA RETENTION

Retention policies must be configurable.

Financial/legal/audit records may require longer retention.

GPS and temporary operational data should use minimized retention.

---

# 73. TIME

Store timestamps in UTC.

Convert for display.

Do not store application timestamps only in Uruguay local time.

---

# 74. CURRENCY

Store explicit currency.

Initial currency:

UYU

Potential future:

USD
BRL

Do not assume every amount is UYU.

---

# 75. TAXES

Tax handling must be configurable.

Do not embed tax assumptions directly into product price algorithms.

Mark uncertain fiscal requirements:

LEGAL_REVIEW_REQUIRED

---

# 76. DEMO / SEED

Development environment should eventually include seed data.

Example:

1 admin
2 merchants
several products
2 drivers
customers
sample zones

Never run destructive seed logic in production.

---

# 77. DOCKER

Development should support Docker Compose for infrastructure.

Expected services:

PostgreSQL
Redis

Potential future:

API
Admin
worker
reverse proxy

---

# 78. CI

GitHub Actions should eventually run:

install
lint
typecheck
tests
build

CI must fail when critical checks fail.

---

# 79. PRODUCTION DEPLOYMENT

Production architecture should allow components to deploy independently.

Do not assume everything must run on one server forever.

---

# 80. MODULE BOUNDARIES

Backend should use domain modules such as:

AuthModule
UsersModule
CustomersModule
MerchantsModule
DriversModule
ProductsModule
OrdersModule
DeliveryModule
DispatchModule
PaymentsModule
BillingModule
SettlementsModule
NotificationsModule
SupportModule
AdminModule
AuditModule

Avoid giant service classes.

---

# 81. CONTROLLERS

Controllers:

- parse request
- validate DTO
- call application/domain services
- return result

Do not place complex business rules in controllers.

---

# 82. SERVICES

Business rules belong in dedicated services.

Prefer explicit functions over hidden side effects.

---

# 83. TRANSACTIONS

Operations such as:

create order
payment approval
order finalization
refund
settlement

may require database transactions.

Analyze atomicity before implementing.

---

# 84. EVENTS

Use domain/application events when useful.

Examples:

OrderCreated
OrderAccepted
OrderReady
DriverAssigned
OrderPickedUp
OrderDelivered
PaymentApproved

Listeners may trigger:

notifications
analytics
audit
background jobs

Critical state changes must not depend entirely on unreliable asynchronous
listeners.

---

# 85. DATE / SCHEDULE

Merchant schedules must support:

days
opening times
closing times
temporary closures
holidays

Keep schedule model flexible.

---

# 86. CART RULES

Initially one cart should belong to one merchant.

Do not mix products from unrelated merchants unless multi-merchant checkout is
explicitly implemented later.

---

# 87. PRODUCT PRICE SNAPSHOT

Order items must snapshot:

product name
selected variant
quantity
unit price
addons
discount
tax information where applicable

Do not calculate old order totals from current product prices.

---

# 88. ADDRESS SNAPSHOT

Orders must snapshot delivery address.

Editing a saved customer address later must not change an existing order.

---

# 89. MERCHANT SNAPSHOT

Relevant merchant information required for historical records may be snapshotted
onto orders.

---

# 90. DELIVERY ASSIGNMENT HISTORY

Track driver assignment history.

If drivers reject or timeout, keep relevant operational history.

Do not simply overwrite driverId without record.

---

# 91. FRAUD PREPARATION

Architecture should allow flags for:

payment anomalies
delivery code failures
customer abuse
merchant abuse
driver abuse

Do not automatically accuse users of fraud.

Store neutral risk events.

---

# 92. USER SUSPENSION

Suspension must not destroy historical data.

Accounts may have states.

Examples:

ACTIVE
SUSPENDED
DISABLED

---

# 93. PRIVILEGED ACTIONS

Dangerous actions should require explicit endpoints.

Examples:

refund
cancel paid order
manual delivery completion
driver suspension
merchant suspension

Every such action requires audit logging.

---

# 94. NO HIDDEN MAGIC

Prefer clear implementation.

Avoid clever abstractions that make debugging difficult.

Code should be understandable by another experienced developer.

---

# 95. DEPENDENCY POLICY

Before adding a dependency ask:

- Is it actively maintained?
- Is it actually necessary?
- Does standard library/framework functionality already solve it?
- Does it introduce security risk?
- Does it increase vendor lock-in?

Avoid unnecessary packages.

---

# 96. MIGRATION SAFETY

Never rewrite old production migrations casually.

Create new migrations.

---

# 97. BACKWARD COMPATIBILITY

When modifying public APIs consider existing clients.

Prefer additive changes when possible.

Breaking changes require documentation.

---

# 98. VERSIONING

Primary API version:

v1

Do not introduce v2 without a real breaking reason.

---

# 99. CODE QUALITY

Use:

TypeScript strict mode.

Avoid:

any

unless justified.

Use clear types.

Use domain-specific enums.

Keep functions reasonably small.

---

# 100. COMMENTS

Comments should explain WHY, not repeat obvious code.

---

# 101. BEFORE IMPLEMENTING ANY REQUEST

Always ask yourself internally:

- What module owns this behavior?
- Does this already exist?
- Does database schema support it?
- Does this require a migration?
- Does API documentation need updating?
- Does frontend need changing?
- Does it affect permissions?
- Does it affect security?
- Does it affect financial data?
- Does it affect legal requirements?
- What tests prove it works?

Then implement.

---

# 102. PRIMARY OBJECTIVE

Produce a real, maintainable, secure application.

Do not optimize for generating the largest quantity of code.

Optimize for:

correctness
maintainability
security
testability
production readiness

Build DeliveryUY phase by phase until it becomes a deployable delivery
marketplace.