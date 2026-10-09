# DeliveryUY

Multi-merchant local delivery marketplace designed initially for Uruguay.

The platform connects:

Customers
Merchants
Drivers
Platform administrators

Core functionality includes:

merchant marketplace
catalogs
orders
payments
dispatch
realtime driver tracking
delivery verification code
commissions
settlements
billing integrations
support
administration

---

# Technology

Mobile:

Flutter

Admin:

Next.js

Backend:

NestJS + TypeScript

Database:

PostgreSQL + Prisma

Realtime:

WebSockets

Cache / Jobs:

Redis

Infrastructure:

Docker

---

# Repository

apps/

Mobile applications (`customer`, `merchant`, `driver`, Flutter) and the
administration panel (`admin`, Next.js).

services/

Backend services (`api`, NestJS modular monolith).

packages/

Shared TypeScript packages (`config`, `types`, `auth`, `database`, provider
interfaces) plus `packages/dart/core`, the Dart contracts shared by the mobile
applications.

docs/

Architecture, requirements and decisions.

infrastructure/

Deployment and infrastructure configuration.

scripts/

Repository tooling (`flutter-check.mjs` runs the Dart quality gate).

---

# Quickstart

Requirements:

- Node.js >= 22
- pnpm 12 (enabled through Corepack, see `packageManager`)
- Flutter stable (only for the mobile applications and `pnpm run flutter:check`)
- Docker (PostgreSQL 16 + Redis 7) for anything that touches infrastructure

```bash
pnpm install                  # install workspace dependencies
cp .env.example .env          # then replace every CHANGE_ME value
pnpm infra:up                 # start PostgreSQL and Redis
pnpm db:generate              # generate the Prisma client
pnpm db:migrate               # apply the migrations
pnpm db:seed                  # reference data + one account per role family
pnpm dev:api                  # http://localhost:3000
pnpm dev:admin                # http://localhost:4000 (needs the API running)
```

The scripts that talk to infrastructure (`dev:*` and `db:*`) load `.env` from
the repository root automatically (`scripts/with-env.mjs`), without overriding a
value already exported in the environment, so the `cp` above is enough.

`pnpm db:seed` requires the fourteen `SEED_*` credentials from `.env`: it
creates one account per role family (`ADMIN`, `SUPER_ADMIN`, `SUPPORT`,
`FINANCE`, `MERCHANT`, `DRIVER`, `CUSTOMER`) so a login can be exercised, and
it refuses to invent a password. The script refuses to run when `APP_ENV` or
`NODE_ENV` is `production`.

The accounts it creates are exactly the ones in `.env` - nothing is hardcoded:

| Role | Variables | Notes |
| --- | --- | --- |
| `ADMIN` | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | `admin@deliveryuy.local` in `.env.example` |
| `SUPER_ADMIN` | `SEED_SUPER_ADMIN_EMAIL`, `SEED_SUPER_ADMIN_PASSWORD` | `superadmin@deliveryuy.local` |
| `SUPPORT` | `SEED_SUPPORT_EMAIL`, `SEED_SUPPORT_PASSWORD` | `support@deliveryuy.local` |
| `FINANCE` | `SEED_FINANCE_EMAIL`, `SEED_FINANCE_PASSWORD` | `finance@deliveryuy.local` |
| `MERCHANT` | `SEED_MERCHANT_EMAIL`, `SEED_MERCHANT_PASSWORD` | `merchant@deliveryuy.local` |
| `DRIVER` | `SEED_DRIVER_EMAIL`, `SEED_DRIVER_PASSWORD` | `driver@deliveryuy.local` |
| `CUSTOMER` | `SEED_CUSTOMER_EMAIL`, `SEED_CUSTOMER_PASSWORD` | `customer@deliveryuy.local` |

`.env.example` ships `CHANGE_ME` for every password on purpose: there is no
default to forget, and the seed fails loudly rather than creating an account
whose credentials are published in the repository. Change
`SEED_*_PASSWORD` before seeding anywhere you care about. These are
development bootstrap credentials and nothing else - the seed is not a
production data set, and no seeded account carries a role beyond the one its
variable names.

Email delivery:

```bash
NOTIFICATION_PROVIDER=smtp         # or "none", which refuses to pretend
SMTP_HOST=smtp.example.com
SMTP_PORT=587                      # 587 = STARTTLS, 465 = implicit TLS
SMTP_FROM=no-reply@deliveryuy.example
SMTP_USER=apikey
SMTP_PASSWORD=secret
REQUIRE_EMAIL_VERIFICATION=false   # true needs a real provider; the schema refuses "none"
```

`SMTP_REQUIRE_TLS` defaults to `true` and must stay that way outside
development: the messages carry a password-reset code and a verification
code, which are bearer credentials. Turning it off is only for a local sink
such as Mailpit on a laptop. `EMAIL_VERIFICATION_TTL_HOURS` (default 24) and
`ACCOUNT_APPROVAL_REQUIRED` (default `false`) control whether proving an
address is what makes an account usable, or whether it must also be approved.

The messages carry a **code to type in the application**, not a link. A link
would need deep-link routing the applications do not have yet, and a link that
opens nothing is worse than an honest instruction.

Mobile applications:

```bash
cd apps/customer
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
```

Useful URLs:

- `GET /api/v1/health/live` - process liveness, never touches infrastructure
- `GET /api/v1/health/ready` - readiness, performs real PostgreSQL/Redis checks
  and answers `503` when a dependency is unreachable
- `/api/docs` - OpenAPI/Swagger UI

Quality gate:

```bash
pnpm verify                   # lint + typecheck + builds + tests + prettier
pnpm run flutter:check        # flutter analyze + flutter test in every Dart workspace
pnpm run verify:all           # both gates
```

Documentation:

- `docs/TESTING.MD` - test layers and how to run them
- `docs/decisions/` - accepted architecture decisions (ADR-001 ... ADR-022)
- `SECURITY.md`, `DATABASE.md`, `LEGAL.md` - non-negotiable constraints
- `packages/database/README.md` - schema, migration and seed commands

---

# Development Process

AI agents and developers must read:

AGENTS.md

before making significant modifications.

Current progress:

PROJECT_STATE.md

Roadmap:

ROADMAP.md

---

# Important

This project handles:

payments
financial data
identity documents
GPS information
business fiscal data

Security and privacy requirements must be treated as first-class concerns.

Legal and fiscal questions marked:

LEGAL_REVIEW_REQUIRED

must be professionally reviewed before production launch.