# Git Rules

Use feature branches when appropriate.

Recommended naming:

feature/auth
feature/orders
feature/merchant
feature/driver
feature/payments

---

# Commit convention

feat:
fix:
refactor:
docs:
test:
chore:
security:

Examples:

feat(auth): implement refresh token rotation

feat(order): add validated state transitions

fix(delivery): prevent duplicate delivery confirmation

security(auth): rate limit failed login attempts

---

# Commit Scope

Keep commits focused.

Avoid commits containing unrelated massive changes.

---

# Before Commit

Run:

lint
typecheck
tests

where available.

---

# Forbidden

Never commit:

.env
secrets
private keys
database dumps containing private data
production credentials
third-party access tokens