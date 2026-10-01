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
pnpm db:seed                  # development reference data (no accounts)
pnpm dev:api                  # http://localhost:3000
pnpm dev:admin                # http://localhost:4000 (needs the API running)
```

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
- `docs/decisions/` - accepted architecture decisions (ADR-001 ... ADR-019)
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