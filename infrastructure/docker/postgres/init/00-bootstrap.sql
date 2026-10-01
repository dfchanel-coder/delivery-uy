-- DeliveryUY development database bootstrap.
--
-- Runs once when the PostgreSQL container initialises an empty data directory.
-- Keep statements idempotent and harmless: this is development tooling only.

-- utf8 is already the server default; explicit for clarity.
SET client_encoding = 'UTF8';

-- Fail fast instead of silently truncating money values.
SET TIME ZONE 'UTC';

DO $$
BEGIN
  IF current_setting('TimeZone') <> 'UTC' THEN
    RAISE NOTICE 'DeliveryUY expects UTC; database timezone is %', current_setting('TimeZone');
  END IF;
END
$$;

-- PostGIS is intentionally NOT enabled here. It is added by a dedicated
-- migration once zone editing or radius search requires it
-- (docs/SCHEMA_PROPOSAL.md section 5).