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