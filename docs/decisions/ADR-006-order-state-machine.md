# ADR-006 - Order State Machine

Status: ACCEPTED

## Decision

Orders use explicit states and validated transitions.

States:

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

Clients cannot arbitrarily update status.

Backend owns transition validation.