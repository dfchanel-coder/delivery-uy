# Admin panel (`apps/admin`)

Next.js App Router application for internal administration. It is an HTTP client
of the backend: it never imports the ORM, and it holds no business rule
(AGENTS.md section 42, `docs/MODULE_BOUNDARIES.md`).

## Current scope (PHASE 01 skeleton)

What exists and works:

- app shell (`src/app`) with two routes: `/` and `/health`;
- `src/lib/api-client.ts`: envelope-aware HTTP transport with timeout,
  correlation id propagation, typed errors (`ApiClientError` with
  `kind`/`code`/`status`/`correlationId`) and response validation through zod;
- `src/lib/delivery-api.ts`: the typed calls the panel makes today (liveness and
  readiness), with response schemas so contract drift fails loudly;
- `src/lib/config.ts`: zod-validated environment (see `.env.example`);
- unit tests for the transport and the configuration (`src/lib/api-client.spec.ts`).

What does **not** exist yet, on purpose:

- authentication, sessions and RBAC enforcement in the UI - the backend
  endpoints they would protect do not exist yet (auth lands in PHASE 03);
- merchant/driver/order/payment modules - each one has its own phase, and
  rendering empty tables with fake data would be a fake implementation
  (AGENTS.md section 5).

## Run it

```bash
pnpm --filter @deliveryuy/admin run dev     # http://localhost:4000
pnpm --filter @deliveryuy/admin run build   # production build (standalone output)
```

The panel needs `API_URL` pointing at a running API; the backend CORS allowlist
must contain the panel origin (`CORS_ORIGINS`).