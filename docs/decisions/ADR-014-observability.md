# ADR-014 - Observability, Correlation and Logging Policy

Status: ACCEPTED

## Context

AGENTS.md section 40 requires structured logging with correlation/request ids
and forbids logging secrets. Support and dispute resolution require the
ability to reconstruct what happened to an order across services, workers and
webhooks.

## Decision

### Correlation

- Every HTTP request receives an `X-Request-Id` (client supplied value is
  accepted only if it matches a strict UUID/length allowlist, otherwise
  generated). It is echoed in the response header.
- A `CorrelationContext` (AsyncLocalStorage based) carries the request id, the
  authenticated `userId` and the current `Idempotency-Key` through services.
- Outbox jobs, notification jobs and webhook deliveries copy the parent
  correlation id into their payload and logs.

### Logging

- Structured JSON logs via `pino` (fast, low overhead, first-class NestJS
  integration through `nestjs-pino`).
- Log levels: `debug` (development only), `info`, `warn`, `error`.
- Every entry includes `level`, `time`, `requestId`, `service`, `env`,
  `route`, `durationMs`, `actorUserId`, `actorRole`, `entityType`,
  `entityId` where applicable.
- A **redaction allowlist** is applied globally. The following are replaced
  with `[redacted]` before serialization: `password`, `passwordHash`,
  `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`,
  `secret`, `apiKey`, `cardNumber`, `cvv`, `verificationCode`,
  `providerSecret`, `smtpPassword`, `privateKey`, `lat`/`lon` of customer and
  driver positions (logged only at `debug` with explicit opt-in).
- Business-relevant state changes are not logged as free text only; they are
  written to `AuditLog` / `OrderTimeline` (queryable, durable) while the log
  receives a short reference.

### Metrics and tracing (interfaces first)

- `MetricsPort` interface with a no-op default implementation. Prometheus
  instrumentation can be added without touching domain code.
- `TracePort` interface; OpenTelemetry is enabled only when
  `OTEL_ENABLED=true` and `OTEL_EXPORTER_OTLP_ENDPOINT` is present.
- Health/metrics endpoints are exposed on a separate internal port and are
  never public without reverse-proxy configuration.

## Consequences

- Debugging an order is possible by searching `requestId`, `orderId` or
  `correlationId`.
- Redaction is enforced in one place; a new sensitive field must be added to
  the allowlist, which is a deliberate friction point.