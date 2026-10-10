# ADR-025 - Merchant Onboarding Grants the MERCHANT Role

Status: ACCEPTED

## Context

`SECURITY.md` ("Self-registration cannot escalate") makes a hard promise:
`POST /auth/register` always creates exactly one `CUSTOMER`, there is no request
field for a role, and `packages/config` refuses to boot with
`REGISTER_DEFAULT_ROLE=ADMIN` or `=MERCHANT`. The point is that a public,
unauthenticated route can never mint a privileged role.

PHASE 05 needs the opposite shape for merchants. A person registers a *business*,
not a *user*, and the business application is reviewed by an administrator before
it can sell. Two designs are possible:

1. the applicant stays `CUSTOMER` and an administrator grants `MERCHANT` when the
   business is approved; or
2. registering the business grants `MERCHANT` immediately, and the review gates
   whether the business can *operate*.

Option 1 sounds strictly safer, and it is the intuition the existing rule
encodes. It was rejected for a concrete reason: the applicant has to author and
edit the business profile - trade name, fiscal name, RUT, address, coordinates -
while the application is under review, and the profile is private. If the
applicant does not hold `MERCHANT`, every one of those routes is refused, so the
review would be performed on data the applicant cannot maintain. The role that
gates "I own a business" is not the role that gates "this business may sell".

## Decision

**Registering a business grants the `MERCHANT` role, and that grant is the one
deliberate, audited exception to "self-registration cannot escalate". The
exception is safe because of what the role does *not* carry.**

- `POST /api/v1/merchants` is authenticated (`JwtAuthGuard`) but requires no
  `@Permissions(...)`: requiring `MERCHANT` here would be circular. It is
  rate-limited per user.
- The grant is performed server-side inside one `UnitOfWork` transaction that
  also inserts the business (status `PENDING_REVIEW`), inserts the `OWNER`
  membership, and writes the `merchant.registered` audit entry. A failure rolls
  all four back.
- `reject`/`approve` cannot be called by the applicant: they live on
  `admin/merchants` behind `admin:merchants:review`, which only `ADMIN`,
  `SUPER_ADMIN` and `SUPPORT` hold.
- What `MERCHANT` grants today is only `merchant:profile:read` and
  `merchant:profile:manage`. It grants **no** order, catalog, settlement or
  dispatch capability, and a `PENDING_REVIEW` business cannot receive orders at
  all (`docs/BUSINESS_RULES.md`). The role is the right to maintain one's own
  business profile; the review is the right to operate.
- `POST /auth/register` is unchanged. It still creates only `CUSTOMER`, and the
  configuration guard is unchanged. The two paths are distinct.

## Consequences

- An account can hold `CUSTOMER` and `MERCHANT` at once, which is already the
  model: roles are a set, not a single value.
- Authorization for a business is membership-based, not role-based. Holding
  `MERCHANT` authorizes *no* particular business; the service resolves the
  business from `merchant_members` and answers `MERCHANT_NOT_FOUND` - never
  `FORBIDDEN` - when there is no membership, so an id cannot be probed to learn
  whether it exists (AGENTS.md sections 29, 32).
- The grant is auditable and revocable: the role assignment is a row in
  `user_roles`, and every registration, approval and rejection writes an
  `audit_logs` entry naming the actor, the role the token carried and the request
  correlation id.
- `docs/BUSINESS_RULES.md` states the invariant that makes this safe: only
  `ACTIVE` merchants can receive orders, and only an administrator moves a
  business to `ACTIVE`.
- If a future role grants operating capability at registration time (for example
  if `MERCHANT` were widened to include catalog writes before approval), the
  safety argument no longer holds. Widening the role to restore the argument
  requires revisiting this ADR.

## Alternatives considered

- **Admin grants the role on approval (option 1).** Rejected because it makes the
  under-review profile unmaintainable by its own owner and forces the review to
  be done against stale data.
- **A dedicated `MERCHANT_APPLICANT` role that is later upgraded.** Rejected as
  inventing a second role whose only distinction is a state already modelled by
  `MerchantStatus`. The status is the gate; a parallel role would be a second
  source of truth for the same fact.
- **Leave `MERCHANT` out and key everything off membership alone.** The
  permission matrix is role-based, so a route needing `merchant:profile:manage`
  still needs a role to hang the permission on. Membership is the tenant check;
  the role is the capability check. They are different questions.

## Legal

No legal implications identified. Merchant identity, RUT and document review are
handled by later slices and the legal notes in `LEGAL.md`; this ADR only concerns
which role is granted at registration.
