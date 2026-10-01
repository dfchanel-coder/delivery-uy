# DeliveryUY Legal / Fiscal Review

This file is not legal advice.

It tracks implementation areas requiring review by appropriate professionals in
Uruguay.

Use:

LEGAL_REVIEW_REQUIRED

whenever application behavior depends on an unresolved legal interpretation.

---

# Driver Relationship

LEGAL_REVIEW_REQUIRED

The platform must not assume that writing "independent contractor" inside terms
automatically determines legal status.

Review:

- applicable Uruguay platform worker regulation;
- relationship between platform and driver;
- insurance obligations;
- social security;
- occupational accident coverage;
- onboarding documentation;
- working-condition obligations;
- algorithmic management implications.

Architecture should allow rules to change.

---

# Taxes

LEGAL_REVIEW_REQUIRED

Review:

- platform taxation;
- merchant taxation;
- commissions;
- driver payments;
- withholding if applicable;
- fiscal documentation.

---

# Electronic Billing

LEGAL_REVIEW_REQUIRED

Prepare BillingProvider for Uruguay electronic invoicing/CFE.

Do not embed a specific vendor into order domain logic.

---

# Personal Data

LEGAL_REVIEW_REQUIRED

Platform handles personal information including:

- identity
- addresses
- phone numbers
- email
- GPS data
- identity documents
- transaction history

Review Uruguay personal data obligations.

Implement:

- privacy policy
- consent where required
- purpose limitation
- data minimization
- retention policies
- access/correction processes
- deletion rules

---

# Driver GPS

High-sensitivity operational information.

Use only for valid delivery purposes.

Minimize retention.

Prevent customers from tracking drivers outside active deliveries.

---

# Terms

Separate terms may be required for:

Customer
Merchant
Driver

---

# Consumer Rules

LEGAL_REVIEW_REQUIRED

Review:

- cancellation
- refunds
- price display
- delivery guarantees
- merchant responsibility
- platform responsibility
- complaints
- promotions

---

# Professional Validation

Before public commercial launch obtain review from:

- Uruguay lawyer knowledgeable in platform/labor/commercial matters;
- accountant;
- electronic invoicing/CFE provider when applicable.

This document exists to prevent developers or AI agents from inventing legal
rules.

---

# Architecture Decisions Awaiting Legal Review

Recorded during PHASE 00. Each item names the architectural decision that must
remain changeable until counsel answers.

| # | Area                            | Architecture impact                                                             | Status |
| - | ------------------------------- | ------------------------------------------------------------------------------- | ------ |
| 1 | Driver relationship model       | `drivers.operational_model`, `terms_version`, ADR-004                            | `LEGAL_REVIEW_REQUIRED` |
| 2 | Algorithmic dispatch             | `ADR-015` proximity scoring; future optimisation strategies                       | `LEGAL_REVIEW_REQUIRED` |
| 3 | Tax model (IVA inclusive/exclusive) | `products.base_price`, `tax_total`, `OrderItem.tax_amount`                    | `LEGAL_REVIEW_REQUIRED` |
| 4 | Electronic invoicing (CFE)       | `BillingProvider`, `billing_documents`                                            | `LEGAL_REVIEW_REQUIRED` |
| 5 | Withholding on payouts           | `settlements`, `driver_earnings`, `refunds`                                      | `LEGAL_REVIEW_REQUIRED` |
| 6 | Data retention windows           | `audit_logs`, `order_timeline`, `ledger_entries`, `driver_locations`             | `LEGAL_REVIEW_REQUIRED` |
| 7 | GPS data basis and consent       | `driver_locations`, realtime tracking, `ADR-012`                                 | `LEGAL_REVIEW_REQUIRED` |
| 8 | Identity document handling       | `driver_documents`, `StorageProvider` signed URLs                                | `LEGAL_REVIEW_REQUIRED` |
| 9 | Consumer cancellation/refund rules | order transitions to `CANCELLED`/`REFUNDED`, refund endpoints                 | `LEGAL_REVIEW_REQUIRED` |
| 10 | Separate terms per audience     | `drivers.terms_accepted_at`, merchant onboarding documents                       | `LEGAL_REVIEW_REQUIRED` |

# Explicit Non-Decisions

The following must not be implemented as if they were settled:

- any driver employment/contract classification wording;
- any statement that a driver is or is not an employee;
- any tax-inclusive price rule;
- any invoicing format or fiscal document numbering;
- any retention period presented as a legal requirement;
- any consent text presented as legally sufficient.

When one of these is needed, stop and mark it instead of guessing.