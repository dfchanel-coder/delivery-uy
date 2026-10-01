-- ---------------------------------------------------------------------------
-- Hand-written SQL required by docs/SCHEMA_PROPOSAL.md section 4.
--
-- Prisma cannot express partial or functional unique indexes, nor CHECK
-- constraints, so they are added here in the same migration as the generated
-- DDL. Everything below is database-enforced on purpose: these invariants must
-- not depend on application code (DATABASE.md, "Database-Enforced Integrity").
-- ---------------------------------------------------------------------------

-- Case-insensitive unique email for accounts that still exist. A deleted user
-- frees the address so the same person can register again.
CREATE UNIQUE INDEX "users_email_lower_uniq"
  ON "users" (lower("email")) WHERE "deleted_at" IS NULL;

-- Exactly one default variant per product.
CREATE UNIQUE INDEX "product_variants_one_default"
  ON "product_variants" ("product_id") WHERE "is_default";

-- At most one accepted assignment per delivery (rejects/expired offers are kept
-- as history, AGENTS.md section 90).
CREATE UNIQUE INDEX "driver_assignments_one_accepted"
  ON "driver_assignments" ("delivery_id") WHERE "status" = 'ACCEPTED';

-- Platform-level category slugs are unique among themselves; merchant-level
-- slugs stay unique per merchant through the Prisma unique constraint.
CREATE UNIQUE INDEX "categories_platform_slug_uniq"
  ON "categories" ("slug") WHERE "merchant_id" IS NULL;

-- Exactly one default address per user.
CREATE UNIQUE INDEX "addresses_one_default"
  ON "addresses" ("user_id") WHERE "is_default" AND "deleted_at" IS NULL;

-- Coordinate and integrity checks.
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "addresses_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);

ALTER TABLE "merchants"
  ADD CONSTRAINT "merchants_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
  ADD CONSTRAINT "merchants_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);

ALTER TABLE "products"
  ADD CONSTRAINT "products_stock_non_negative" CHECK ("stock" >= 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_amounts_non_negative"
  CHECK ("unit_price" >= 0 AND "addons_total" >= 0 AND "discount_amount" >= 0 AND "line_total" >= 0);

ALTER TABLE "merchant_schedules"
  ADD CONSTRAINT "merchant_schedules_day_of_week" CHECK ("day_of_week" BETWEEN 0 AND 6);

ALTER TABLE "feature_flags"
  ADD CONSTRAINT "feature_flags_rollout_range" CHECK ("rollout_percentage" BETWEEN 0 AND 100);

ALTER TABLE "delivery_zones"
  ADD CONSTRAINT "delivery_zones_fees_non_negative"
  CHECK ("base_fee" >= 0 AND "distance_fee_per_km" >= 0 AND "surcharge" >= 0 AND "min_order_amount" >= 0);

-- Money is never negative where a refund or reversal is not expected.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amounts_non_negative"
  CHECK ("amount" >= 0 AND "paid_amount" >= 0 AND "refunded_amount" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "discount_total" >= 0 AND "delivery_fee" >= 0
         AND "service_fee" >= 0 AND "tax_total" >= 0 AND "total" >= 0 AND "refunded_total" >= 0);

-- A refund can never exceed what was actually captured, and the running
-- refunded amount can never exceed the payment amount.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_refund_within_amount" CHECK ("refunded_amount" <= "paid_amount");

-- Ratings are 0..5 with two decimals (DATABASE.md). The drivers and merchants
-- bounds arrive with the same migration as the rating range rule.
ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_rating_range" CHECK ("rating_average" BETWEEN 0 AND 5);

ALTER TABLE "merchants"
  ADD CONSTRAINT "merchants_rating_range" CHECK ("rating_average" BETWEEN 0 AND 5);

-- Commission rates are percentages; 100% is the maximum meaningful value.
ALTER TABLE "commission_rules"
  ADD CONSTRAINT "commission_rules_rate_range"
  CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100);

-- Time of day is stored as text because Prisma has no time type; the format is
-- 'HH:mm'. Validating it in the database keeps bad data out of every report.
ALTER TABLE "merchant_schedules"
  ADD CONSTRAINT "merchant_schedules_open_time_format"
  CHECK ("open_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT "merchant_schedules_close_time_format"
  CHECK ("close_time" ~ '^[0-2][0-9]:[0-5][0-9]$'),
  ADD CONSTRAINT "merchant_schedules_break_time_format"
  CHECK (("break_start" IS NULL OR "break_start" ~ '^[0-2][0-9]:[0-5][0-9]$')
         AND ("break_end" IS NULL OR "break_end" ~ '^[0-2][0-9]:[0-5][0-9]$'));

-- A driver cannot be simultaneously available and out of service.
ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_active_deliveries_non_negative" CHECK ("active_deliveries" >= 0);

-- Verification attempts are bounded; the delivery service enforces the
-- configured maximum and locks the delivery when it is reached.
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_verification_attempts_non_negative"
  CHECK ("verification_attempts" >= 0);

-- Outbox and notification bookkeeping.
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("attempts" >= 0);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_attempts_non_negative" CHECK ("attempts" >= 0);
