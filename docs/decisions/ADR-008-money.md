# ADR-008 - Monetary Value Representation

Status: ACCEPTED

## Context

DeliveryUY stores delivery fees, commissions, driver earnings, refunds and
settlements. These values must be reproducible years later (AGENTS.md
sections 19, 20, 21). Floating point arithmetic is not acceptable.

## Decision

Money is stored as PostgreSQL `NUMERIC(14, 2)` exposed through Prisma
`Decimal` (`@prisma/client/runtime`) and manipulated with
`decimal.js`-compatible arithmetic (Prisma's bundled `Decimal`).

Rules:

1. Column type: `NUMERIC(14, 2)` for amounts, `NUMERIC(7, 4)` for rates and
   percentages.
2. Application code never uses `number`, `float` or `parseFloat` for money.
   Money in TypeScript is `Prisma.Decimal` (or `Money` value object in
   `packages/money` once introduced).
3. JSON transport converts money to **fixed 2-decimal strings**
   (AGENTS.md section 36, `docs/API_RULES.md`). Clients parse them; never send
   binary floating point approximations.
4. Every monetary row carries an explicit `currency` column (`CHAR(3)`
   ISO 4217). Initial value `UYU`; the schema supports `USD`, `BRL`, etc.
5. Quantities are integers. Rounding is `ROUND_HALF_UP` to currency minor
   units and must be explicit at the point of calculation.
6. Totals are **frozen at order creation** and stored on the order and on the
   financial ledger entries. Recomputation from current configuration is
   forbidden (AGENTS.md section 87).
7. Comparison of money happens in the database when possible, in code through
   `Decimal` methods (`lt`, `lte`, `gte`, `plus`, `minus`, `times`) - never
   through JavaScript operators that coerce to `number`.

## Consequences

Positive:

- deterministic, auditable and reproducible totals;
- safe multi-currency evolution;
- no rounding drift between platform, merchant and driver figures.

Negative:

- Prisma returns `Decimal` instances, so serialization must be explicit
  (an interceptor/`MoneySerializer` helper is required);
- arithmetic-heavy code is more verbose.

## Alternatives considered

- **Integer minor units (e.g. cents)**: rejected for the database layer because
  numeric scale is currency dependent (UYU and USD both use 2, but the model
  must not assume it). Kept as an option for a future in-memory value object
  only.
- **`Float` / `double precision`**: rejected, causes rounding errors.
- **String money**: rejected, prevents numeric aggregation in SQL.