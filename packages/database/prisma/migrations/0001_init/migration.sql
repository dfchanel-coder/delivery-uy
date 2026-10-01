-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AppRole" AS ENUM ('CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'FINANCE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MerchantMemberRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'STAFF');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'PAUSED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('FOOT', 'BICYCLE', 'MOTORCYCLE', 'CAR', 'VAN');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('IDENTITY', 'LICENSE', 'VEHICLE_REGISTRATION', 'INSURANCE', 'TAX_ID', 'CERTIFICATE');

-- CreateEnum
CREATE TYPE "ZoneKind" AS ENUM ('POLYGON', 'RADIUS', 'POSTAL', 'NEIGHBORHOOD');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAID', 'REJECTED', 'ACCEPTED', 'PREPARING', 'READY', 'DRIVER_SEARCHING', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SYSTEM', 'CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN', 'WEBHOOK', 'JOB');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SEARCHING', 'ASSIGNED', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE_CARD', 'WALLET', 'CASH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'APPROVED', 'FAILED', 'REJECTED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "CommissionScope" AS ENUM ('GLOBAL', 'CITY', 'MERCHANT_CATEGORY', 'MERCHANT', 'CAMPAIGN');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('PUSH', 'EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "FlagScope" AS ENUM ('GLOBAL', 'CITY', 'MERCHANT', 'USER');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "VerificationTokenType" AS ENUM ('EMAIL_VERIFY', 'EMAIL_CHANGE', 'PHONE_VERIFY', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone_e164" VARCHAR(20),
    "password_hash" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "email_verified_at" TIMESTAMPTZ(3),
    "phone_verified_at" TIMESTAMPTZ(3),
    "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "locale" VARCHAR(10) NOT NULL DEFAULT 'es',
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" "AppRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "replaced_by_id" UUID,
    "refresh_token_hash" CHAR(64) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_reason" VARCHAR(120),
    "rotated_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "requested_ip" VARCHAR(45),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "VerificationTokenType" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "destination" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "photo_url" VARCHAR(512),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "zone_id" UUID,
    "label" VARCHAR(60) NOT NULL,
    "recipient_name" VARCHAR(160) NOT NULL,
    "street" VARCHAR(160) NOT NULL,
    "street_number" VARCHAR(20) NOT NULL,
    "apartment" VARCHAR(80),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "instructions" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "default_currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "cities" (
    "id" UUID NOT NULL,
    "country_code" CHAR(3) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "department_or_state" VARCHAR(120),
    "timezone" VARCHAR(64) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "kind" "ZoneKind" NOT NULL,
    "geometry" JSONB,
    "center_latitude" DECIMAL(9,6),
    "center_longitude" DECIMAL(9,6),
    "radius_meters" DECIMAL(10,2),
    "base_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "distance_fee_per_km" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "surcharge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "min_order_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "max_radius_meters" DECIMAL(10,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "commission_rule_id" UUID,
    "trade_name" VARCHAR(160) NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "rut" VARCHAR(32) NOT NULL,
    "rut_normalized" VARCHAR(32) NOT NULL,
    "description" VARCHAR(2000),
    "status" "MerchantStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "phone_e164" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "address_line" VARCHAR(255) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "accepting_orders" BOOLEAN NOT NULL DEFAULT false,
    "temporarily_closed_until" TIMESTAMPTZ(3),
    "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_user_id" UUID,
    "rejection_reason" VARCHAR(500),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_members" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MerchantMemberRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_schedules" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "open_time" VARCHAR(5) NOT NULL,
    "close_time" VARCHAR(5) NOT NULL,
    "is_open" BOOLEAN NOT NULL DEFAULT true,
    "break_start" VARCHAR(5),
    "break_end" VARCHAR(5),
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),

    CONSTRAINT "merchant_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_closures" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" VARCHAR(255),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "merchant_id" UUID,
    "parent_id" UUID,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "category_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stock_managed" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "preparation_minutes" INTEGER NOT NULL DEFAULT 15,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "alt_text" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price_delta" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_managed" BOOLEAN NOT NULL DEFAULT false,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_addons" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "max_quantity" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "vehicle_type" "VehicleType" NOT NULL DEFAULT 'MOTORCYCLE',
    "vehicle_make" VARCHAR(80),
    "vehicle_model" VARCHAR(80),
    "vehicle_plate" VARCHAR(16),
    "vehicle_color" VARCHAR(40),
    "vehicle_year" INTEGER,
    "operational_model" VARCHAR(60),
    "rating_average" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "active_deliveries" INTEGER NOT NULL DEFAULT 0,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "rejection_reason" VARCHAR(500),
    "terms_accepted_at" TIMESTAMPTZ(3),
    "terms_version" VARCHAR(40),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "storage_key" VARCHAR(400) NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3),
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "rejection_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_locations" (
    "id" BIGSERIAL NOT NULL,
    "driver_id" UUID NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "accuracy_meters" DECIMAL(8,2),
    "speed_kph" DECIMAL(6,2),
    "heading" DECIMAL(6,2),
    "source" VARCHAR(20) NOT NULL DEFAULT 'app',
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "scope" "CommissionScope" NOT NULL,
    "city_id" UUID,
    "merchant_id" UUID,
    "category_id" UUID,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "flat_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "effective_to" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "code" VARCHAR(12) NOT NULL,
    "customer_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "driver_id" UUID,
    "city_id" UUID NOT NULL,
    "zone_id" UUID,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "delivery_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "service_fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "refunded_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "customer_note" VARCHAR(500),
    "merchant_note" VARCHAR(500),
    "rejection_reason" VARCHAR(500),
    "cancelled_by_user_id" UUID,
    "cancellation_reason" VARCHAR(500),
    "delivery_address_snapshot" JSONB NOT NULL,
    "merchant_snapshot" JSONB NOT NULL,
    "financial_snapshot" JSONB,
    "idempotency_key" VARCHAR(120),
    "accepted_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "picked_up_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "disputed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "product_variant_id" UUID,
    "product_name_snapshot" VARCHAR(200) NOT NULL,
    "variant_snapshot" JSONB,
    "addons_snapshot" JSONB,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "addons_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(300),

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_timeline" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "AppRole",
    "metadata" JSONB,
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "driver_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "pickup_latitude" DECIMAL(9,6) NOT NULL,
    "pickup_longitude" DECIMAL(9,6) NOT NULL,
    "dropoff_latitude" DECIMAL(9,6) NOT NULL,
    "dropoff_longitude" DECIMAL(9,6) NOT NULL,
    "distance_meters" DECIMAL(10,2),
    "estimated_duration_seconds" INTEGER,
    "verification_code_hash" VARCHAR(128) NOT NULL,
    "verification_code_salt" VARCHAR(64) NOT NULL,
    "verification_code_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verification_attempts" INTEGER NOT NULL DEFAULT 0,
    "verification_locked_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "verified_by_user_id" UUID,
    "exception_reason" VARCHAR(500),
    "exception_approved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'OFFERED',
    "sequence" INTEGER NOT NULL,
    "distance_meters" DECIMAL(10,2),
    "offered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "response_reason" VARCHAR(200),

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_code_attempts" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_address" VARCHAR(45),
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_code_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_payment_id" VARCHAR(160),
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "metadata" JSONB,
    "idempotency_key" VARCHAR(120),
    "authorized_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "provider_refund_id" VARCHAR(160),
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID,
    "idempotency_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_event_id" VARCHAR(160) NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "AppRole",
    "action" VARCHAR(120) NOT NULL,
    "entity_type" VARCHAR(80) NOT NULL,
    "entity_id" VARCHAR(64),
    "metadata" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(512),
    "correlation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(80) NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "user_id" UUID,
    "request_hash" CHAR(64) NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "resource_type" VARCHAR(80),
    "resource_id" VARCHAR(64),
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "value" JSONB NOT NULL,
    "description" VARCHAR(500),
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "scope" "FlagScope" NOT NULL DEFAULT 'GLOBAL',
    "scope_ref" VARCHAR(64),
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_percentage" INTEGER NOT NULL DEFAULT 100,
    "description" VARCHAR(500),
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" UUID NOT NULL,
    "subject_type" VARCHAR(60) NOT NULL,
    "subject_id" VARCHAR(64) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "severity" "RiskSeverity" NOT NULL DEFAULT 'LOW',
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template_key" VARCHAR(120) NOT NULL,
    "payload" JSONB,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "provider_message_id" VARCHAR(160),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "target" VARCHAR(400) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_outbound" (
    "id" UUID NOT NULL,
    "topic" VARCHAR(120) NOT NULL,
    "target" VARCHAR(512) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_outbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_family_id_idx" ON "sessions"("family_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "verification_tokens_user_id_type_idx" ON "verification_tokens"("user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_hash_key" ON "verification_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "addresses_user_id_deleted_at_idx" ON "addresses"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "addresses_city_id_idx" ON "addresses"("city_id");

-- CreateIndex
CREATE INDEX "addresses_zone_id_idx" ON "addresses"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_merchant_id_key" ON "favorites"("user_id", "merchant_id");

-- CreateIndex
CREATE INDEX "cities_enabled_idx" ON "cities"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "cities_country_code_name_key" ON "cities"("country_code", "name");

-- CreateIndex
CREATE INDEX "delivery_zones_city_id_enabled_idx" ON "delivery_zones"("city_id", "enabled");

-- CreateIndex
CREATE INDEX "delivery_zones_city_id_priority_idx" ON "delivery_zones"("city_id", "priority");

-- CreateIndex
CREATE INDEX "merchants_city_id_status_idx" ON "merchants"("city_id", "status");

-- CreateIndex
CREATE INDEX "merchants_owner_user_id_idx" ON "merchants"("owner_user_id");

-- CreateIndex
CREATE INDEX "merchants_status_accepting_orders_idx" ON "merchants"("status", "accepting_orders");

-- CreateIndex
CREATE INDEX "merchants_deleted_at_idx" ON "merchants"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_rut_normalized_key" ON "merchants"("rut_normalized");

-- CreateIndex
CREATE INDEX "merchant_members_user_id_idx" ON "merchant_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_members_merchant_id_user_id_key" ON "merchant_members"("merchant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_schedules_merchant_id_day_of_week_key" ON "merchant_schedules"("merchant_id", "day_of_week");

-- CreateIndex
CREATE INDEX "merchant_closures_merchant_id_starts_at_idx" ON "merchant_closures"("merchant_id", "starts_at");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_merchant_id_slug_key" ON "categories"("merchant_id", "slug");

-- CreateIndex
CREATE INDEX "products_merchant_id_enabled_idx" ON "products"("merchant_id", "enabled");

-- CreateIndex
CREATE INDEX "products_category_id_enabled_idx" ON "products"("category_id", "enabled");

-- CreateIndex
CREATE INDEX "products_deleted_at_idx" ON "products"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_merchant_id_slug_key" ON "products"("merchant_id", "slug");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_variants_product_id_enabled_idx" ON "product_variants"("product_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_name_key" ON "product_variants"("product_id", "name");

-- CreateIndex
CREATE INDEX "product_addons_product_id_enabled_idx" ON "product_addons"("product_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "product_addons_product_id_name_key" ON "product_addons"("product_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "drivers_city_id_status_availability_idx" ON "drivers"("city_id", "status", "availability");

-- CreateIndex
CREATE INDEX "drivers_availability_active_deliveries_idx" ON "drivers"("availability", "active_deliveries");

-- CreateIndex
CREATE INDEX "drivers_deleted_at_idx" ON "drivers"("deleted_at");

-- CreateIndex
CREATE INDEX "driver_documents_driver_id_type_idx" ON "driver_documents"("driver_id", "type");

-- CreateIndex
CREATE INDEX "driver_documents_status_idx" ON "driver_documents"("status");

-- CreateIndex
CREATE INDEX "driver_locations_driver_id_recorded_at_idx" ON "driver_locations"("driver_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "commission_rules_scope_effective_from_effective_to_idx" ON "commission_rules"("scope", "effective_from", "effective_to");

-- CreateIndex
CREATE INDEX "commission_rules_merchant_id_idx" ON "commission_rules"("merchant_id");

-- CreateIndex
CREATE INDEX "commission_rules_city_id_idx" ON "commission_rules"("city_id");

-- CreateIndex
CREATE INDEX "orders_customer_id_created_at_idx" ON "orders"("customer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_merchant_id_status_created_at_idx" ON "orders"("merchant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_driver_id_created_at_idx" ON "orders"("driver_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_city_id_created_at_idx" ON "orders"("city_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_code_key" ON "orders"("code");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_timeline_order_id_created_at_idx" ON "order_timeline"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_driver_id_status_idx" ON "deliveries"("driver_id", "status");

-- CreateIndex
CREATE INDEX "driver_assignments_delivery_id_status_idx" ON "driver_assignments"("delivery_id", "status");

-- CreateIndex
CREATE INDEX "driver_assignments_driver_id_status_idx" ON "driver_assignments"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "driver_assignments_delivery_id_sequence_key" ON "driver_assignments"("delivery_id", "sequence");

-- CreateIndex
CREATE INDEX "delivery_code_attempts_delivery_id_created_at_idx" ON "delivery_code_attempts"("delivery_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "payment_webhook_events_status_received_at_idx" ON "payment_webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_provider_event_id_key" ON "payment_webhook_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_key_key" ON "idempotency_keys"("scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE INDEX "risk_events_subject_type_subject_id_created_at_idx" ON "risk_events"("subject_type", "subject_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "risk_events_type_created_at_idx" ON "risk_events"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "device_subscriptions_user_id_channel_idx" ON "device_subscriptions"("user_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "device_subscriptions_channel_target_key" ON "device_subscriptions"("channel", "target");

-- CreateIndex
CREATE INDEX "webhook_outbound_status_next_attempt_at_idx" ON "webhook_outbound"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_commission_rule_id_fkey" FOREIGN KEY ("commission_rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_members" ADD CONSTRAINT "merchant_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_schedules" ADD CONSTRAINT "merchant_schedules_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_closures" ADD CONSTRAINT "merchant_closures_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_addons" ADD CONSTRAINT "product_addons_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_locations" ADD CONSTRAINT "driver_locations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_timeline" ADD CONSTRAINT "order_timeline_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_code_attempts" ADD CONSTRAINT "delivery_code_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_code_attempts" ADD CONSTRAINT "delivery_code_attempts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_subscriptions" ADD CONSTRAINT "device_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
