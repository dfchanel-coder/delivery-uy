# DeliveryUY Architecture Decision Records

Status legend: `PROPOSED` -> `ACCEPTED` -> `SUPERSEDED` / `REJECTED`.

An accepted ADR must not be contradicted by implementation. Changing an
accepted decision requires a new ADR that explicitly supersedes it
(AGENTS.md section 3).

| ADR | Title                                            | Status                          |
| --- | ------------------------------------------------ | ------------------------------- |
| [001](ADR-001-stack.md) | Technology Stack                            | ACCEPTED                        |
| [002](ADR-002-authentication.md) | Authentication                       | ACCEPTED                        |
| [003](ADR-003-payments.md) | Payments                                | ACCEPTED                        |
| [004](ADR-004-driver-model.md) | Driver Model                        | ACCEPTED WITH LEGAL REVIEW      |
| [005](ADR-005-maps.md) | Maps                                          | ACCEPTED                        |
| [006](ADR-006-order-state-machine.md) | Order State Machine                | ACCEPTED                        |
| [007](ADR-007-monorepo.md) | Monorepo Layout and Package Manager     | ACCEPTED                        |
| [008](ADR-008-money.md) | Monetary Value Representation             | ACCEPTED                        |
| [009](ADR-009-identifiers-timestamps-soft-delete.md) | Identifiers, Timestamps, Soft Delete, Transactions | ACCEPTED       |
| [010](ADR-010-delivery-code.md) | Delivery Verification Code            | ACCEPTED                        |
| [011](ADR-011-idempotency.md) | Idempotency Strategy                   | ACCEPTED                        |
| [012](ADR-012-realtime.md) | Realtime Architecture                      | ACCEPTED                        |
| [013](ADR-013-configuration-and-feature-flags.md) | Configuration and Feature Flags | ACCEPTED                       |
| [014](ADR-014-observability.md) | Observability, Correlation, Logging   | ACCEPTED                        |
| [015](ADR-015-dispatch-engine.md) | Dispatch Engine Strategy             | ACCEPTED (LEGAL_REVIEW_REQUIRED)|
| [016](ADR-016-testing-topology.md) | Testing Topology                      | ACCEPTED                        |
| [017](ADR-017-test-transform.md) | Test Transform of NestJS Sources    | ACCEPTED                        |
| [018](ADR-018-frontend-workspaces.md) | Frontend Workspaces and Shared Client Logic | ACCEPTED             |
| [019](ADR-019-migration-verification.md) | Verifying Database Migrations without a Local Database | ACCEPTED |
| [020](ADR-020-cryptography-libraries.md) | Cryptography Libraries for Password Hashing and Access Tokens | ACCEPTED |

## Naming

`ADR-NNN-short-topic.md`, sequential, never reused, never renumbered.

## Template

```markdown
# ADR-NNN - Title

Status: PROPOSED | ACCEPTED | SUPERSEDED BY ADR-XXX | REJECTED

## Context

What forces are at play. No decision.

## Decision

The rule, concretely.

## Consequences

Positive, negative, mitigation.

## Alternatives considered

What was rejected and why.

## Legal

LEGAL_REVIEW_REQUIRED items, if any.
```

## Related

- `docs/decisions/prompts/PHASE_TEMPLATE.md`
- `docs/decisions/prompts/REVIEW_PROMPT.md`
- `LEGAL.md` - professional review requirements