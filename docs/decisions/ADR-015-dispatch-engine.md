# ADR-015 - Dispatch Engine Strategy

Status: ACCEPTED

## Context

When an order becomes `READY`, a driver must be found (AGENTS.md section 17).
The initial algorithm must be simple and transparent, but the architecture
must permit sophisticated optimization later without rewriting order or
delivery logic. Business logic must not live inside controllers.

## Decision

- `DispatchEngine` is an **interface** in `packages/dispatch` (hosted inside
  `services/api/src/modules/dispatch` until the package is extracted), with a
  `DispatchProvider` registry resolved by configuration
  (`DISPATCH_STRATEGY=proximity-v1`).
- v1 strategy `ProximityDispatchEngine`:
  - candidate set = drivers with `availability = ONLINE`,
    `status = APPROVED`, `vehicleType` eligible for the order's zone, no
    active delivery, city match (or `crossCityEnabled` runtime flag).
  - ordering = ascending straight-line distance from driver position
    (Redis `GEOADD`/`GEOSEARCH`) with a deterministic tiebreaker
    (`driverId`) so results are reproducible.
  - batch size `DISPATCH_BATCH_SIZE` (default 5) offers are sent in parallel.
  - offer expiry `DISPATCH_OFFER_TTL` (default 45 s); expired offers move to
    the next candidate batch.
  - after `DISPATCH_MAX_ROUNDS` (default 10) the delivery enters
    `NO_DRIVER_AVAILABLE` operational state and raises a `RiskEvent` plus an
    admin notification. It never auto-transitions the order to `CANCELLED`.
- Offer, accept, reject and expiry are persisted in `DriverAssignment` with
  a monotonically increasing `sequence`, so the full offer history is retained
  (AGENTS.md section 90).
- Acceptance uses a conditional update
  (`UPDATE ... WHERE status = 'OFFERED' AND driver_id = :driver`) inside a
  transaction, making double acceptance impossible under concurrency.
- Dispatch runs as a background job (BullMQ on Redis), never inside the HTTP
  request that set the order to `READY`.

## Consequences

- Future strategies (batching multiple orders, learned scoring, fairness
  rotation, zone-based quotas) can be added by implementing the interface and
  registering a provider, without touching `OrdersModule` or `DeliveryModule`.
- Fairness, driver fatigue limits and preference rules are explicitly out of
  scope for v1 and tracked as future work.

## Legal note

`LEGAL_REVIEW_REQUIRED` - algorithmic management of drivers may have labour-law
implications in Uruguay (see LEGAL.md and ADR-004). v1 must be documented as a
proximity-based assignment, and any future scoring strategy requires legal
review before launch.