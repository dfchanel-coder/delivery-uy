# DeliveryUY Business Rules

## Cart

Initial implementation:

One active cart can contain products from one merchant only.

---

# Order

Order totals are frozen when order is created.

Product price changes must not affect existing orders.

---

# Merchant

Only ACTIVE merchants can receive orders.

Merchant must not edit finalized historical order prices.

## Onboarding

Registering a business is how an account becomes a merchant. It grants the
`MERCHANT` role (the deliberate exception in `ADR-025`) and creates the business
in `PENDING_REVIEW` with the caller as its `OWNER`.

A business must have a valid RUT (check digit verified), a legal name, a trade
name and an enabled city. The RUT is stored normalized (digits only) and is
unique across businesses; it is immutable after creation.

## Review

Only an administrator holding `admin:merchants:review` moves a business to
`ACTIVE` or `REJECTED`. Every decision is recorded in the audit log. The review
is what gates operating; the `MERCHANT` role alone does not.

`PENDING_REVIEW -> ACTIVE` or `-> REJECTED`; a `REJECTED` business may be later
approved. `ACTIVE -> SUSPENDED` or `-> DISABLED`; `SUSPENDED -> ACTIVE` or
`-> DISABLED`; `DISABLED` is terminal.

## Profile

A business profile may be edited by an `OWNER` or `MANAGER` member in any
non-`DISABLED` status. The legal name of an `ACTIVE` business is not
self-editable (`MERCHANT_INVALID_STATE`): changing it after approval is an
identity change and goes through support.

Authorization for a specific business is by membership, and a non-member is
answered as if the business did not exist (`MERCHANT_NOT_FOUND`), never
`FORBIDDEN`.

---

# Driver

Only APPROVED drivers may deliver.

Only ONLINE drivers may receive new offers.

A BUSY driver normally does not receive another offer unless multi-order
delivery is implemented.

---

# Delivery

A delivery cannot be completed without:

valid delivery code

or

authorized manual exception.

---

# Delivery Code

Customer knows the code.

Driver does not.

Driver enters customer-provided code.

Backend validates it.

---

# Cancellation

Cancellation behavior depends on order status.

A paid order cancellation may require refund workflow.

Do not implement one universal cancellation path.

---

# Commission

Commission is calculated at order time.

The resulting values are stored.

Changing commission later must not change historical orders.

---

# Address

Order contains address snapshot.

Editing customer's saved address does not update active/historical orders.

---

# Money

Financial calculations must use deterministic decimal arithmetic.