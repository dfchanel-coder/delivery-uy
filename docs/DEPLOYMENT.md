# Deployment

## Environments

development
staging
production

Each environment must have separate:

database
Redis
credentials
payment credentials
storage
API keys

---

# Initial Infrastructure

Docker supported.

Development services:

PostgreSQL
Redis

---

# Production

Production must use HTTPS.

Potential components:

reverse proxy
API
worker
admin web
PostgreSQL
Redis
object storage

---

# Backups

Production PostgreSQL requires scheduled backups.

Restoration procedure must be tested.

---

# Monitoring

Prepare for:

application errors
API latency
failed jobs
payment webhook failures
database health
Redis health
WebSocket health

## Health probes

Two endpoints, both public because an orchestrator cannot present a token to
ask whether the process is alive.

| Endpoint | Contract |
| --- | --- |
| `GET /api/v1/health/live` | `200` as soon as the process can serve. Touches no infrastructure, so a database outage cannot cause a restart loop |
| `GET /api/v1/health/ready` | `200` with `status: ready` only when PostgreSQL and Redis both answered; `503` with `status: degraded` and a per-dependency verdict otherwise |

The readiness probe opens its own short-lived clients rather than reusing the
application pool, so that a poisoned pool cannot make the probe lie. The cost is
that every probe pays a cold connect, and `HEALTH_CHECK_TIMEOUT_MS` therefore
bounds **connecting plus querying**, not the query alone. 2000 ms is ample when
the database is a local container or socket; raise it for a managed instance
across a network. Do not raise it without cause: a budget far above what a real
connection costs turns a genuine hang into a slow success, and one above about a
second can exceed an orchestrator's own probe timeout, which fails the probe
regardless.

`readiness()` cannot reject. A dependency exceeding its budget is reported as a
verdict naming that dependency, never as a `500`, because the two provoke
different reactions from a load balancer.

To see both probes answered by a real API against real endpoints:

```bash
pnpm run infra:verify   # last step boots the API and reads them over HTTP
```