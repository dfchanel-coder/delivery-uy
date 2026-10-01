# ADR-005 - Maps

Status: ACCEPTED

## Decision

Use MapProvider abstraction.

No domain logic may depend directly on Google Maps, Mapbox or another vendor.

## Reason

Reduces vendor lock-in and allows cost/provider changes.