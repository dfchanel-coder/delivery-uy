# API Rules

Base:

/api/v1

---

# Success

Use predictable JSON responses.

Example:

{
  "data": {}
}

---

# Error

{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable explanation.",
    "details": {},
    "correlationId": "0f6d5b7e-1f4a-4a1f-9a2c-2f2f4f9a1c22"
  }
}

`details` is optional and never contains stack traces, SQL text or provider
payloads. `correlationId` is always present and matches the `X-Request-Id`
response header, so a failure can be reported with a single value (ADR-014).

---

# Correlation

Every response carries `X-Request-Id`.

A client supplied value is reused only when it is safe (printable, bounded
length); otherwise the server generates a UUID.

---

# Pagination

Example:

GET /api/v1/merchants?limit=20&cursor=abc

Response:

{
  "data": [],
  "pagination": {
    "nextCursor": null
  }
}

---

# Authentication

Authorization:

Bearer <access_token>

---

# Dates

ISO 8601.

UTC from backend.

---

# Money

Return monetary fields consistently.

Never return binary floating point approximations.

---

# Endpoint Security

Every endpoint must explicitly determine:

public
authenticated
role protected
resource ownership protected

---

# Documentation

OpenAPI document: `/api/docs` (Swagger UI) and `/api/docs-json`.

Paths already include the `/api/v1` prefix and the document declares no server
host, so it resolves against whatever origin serves it (reverse proxies and
multi-domain deployments must not be baked into the specification).