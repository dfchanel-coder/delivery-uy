# ADR-016 - Testing Topology

Status: ACCEPTED. The isolation bullet is superseded by ADR-023.

## Context

AGENTS.md sections 41 and 65 require tests for authentication, permissions,
order state machine, pricing, payments, delivery verification and settlements.
`docs/TESTING.MD` states that a successful HTTP response is not enough: the
resulting database state must be verified.

Testing domain code against a mocked database would give false confidence:
constraints, transactions and numeric behaviour live in PostgreSQL.

## Decision

- **Runner**: `vitest` for unit tests (fast, native ESM/TS, no global
  jest/ts-jest transform configuration), `supertest` + NestJS testing
  utilities for HTTP-level tests.
- **Unit tests** cover pure domain logic with no I/O: order transition
  validator, money calculations, commission calculations, delivery code
  generation/hashing, RBAC policy evaluation, dispatch eligibility filters,
  fee calculation, id/cursor encoding.
- **Integration and API tests run against a real PostgreSQL database** (and
  Redis when the behaviour involves it), provided by
  `infrastructure/docker/docker-compose.test.yml`. Mocking `PrismaClient` is
  forbidden for repository-level tests.
- Each test file runs against its own isolated schema, allowing parallel
  execution without cross-test interference. **Superseded by ADR-023**: the suite
  uses one schema with explicit truncation and runs on a single fork.
- `docs/TESTING.MD` rule enforced: assertions include querying the database for
  resulting rows (order status, ledger entries, audit log).
- Provider adapters (MercadoPago, FCM, S3, maps) are tested against
  contract-test fakes implementing the provider interface, plus recorded
  fixture payloads for webhook signature validation. No network calls in tests.
- Time is injected (`Clock` port) so expiry/TTL logic is deterministic.
- Coverage thresholds are enforced in CI for `services/api/src/modules` and
  `packages/*/src`; thresholds are raised progressively, never lowered.
- Flutter: `flutter_test` + `integration_test` for critical flows (order
  placement, delivery code display).

## Consequences

- Tests cannot run without Docker, which must be documented in the readme and
  verified in CI (GitHub Actions service containers).
- Slower feedback than pure unit tests, but far higher signal on correctness
  of money, state machine and authorization behaviour.