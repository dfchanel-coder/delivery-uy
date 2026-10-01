# ADR-002 - Authentication

Status: ACCEPTED

## Decision

Use short-lived JWT access tokens and rotating refresh tokens.

Refresh token representations are stored securely on backend.

## Reason

Allows mobile/web authentication while supporting session revocation and
reasonable security.