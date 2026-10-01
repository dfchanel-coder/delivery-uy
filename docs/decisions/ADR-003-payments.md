# ADR-003 - Payments

Status: ACCEPTED

## Decision

Use PaymentProvider abstraction.

Payment domain logic must not depend directly on Mercado Pago.

## Reason

Allows provider changes and multiple payment methods without rewriting order
domain logic.