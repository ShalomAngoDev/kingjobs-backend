-- BO04 — création mission V2 + validation KingJOBS avant publication
-- Additive / backward compatible (defaults + nullable).

-- MissionStatus : nouveaux états de revue (ordre logique, pas d'ordre enum PG requis)
ALTER TYPE "MissionStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "MissionStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CHANGES';
ALTER TYPE "MissionStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

CREATE TYPE "MissionSchedulingType" AS ENUM ('ONCE', 'CONSECUTIVE_DAYS', 'SELECTED_DAYS');
CREATE TYPE "MissionPricingType" AS ENUM ('FIXED', 'HOURLY', 'DAILY');
CREATE TYPE "MissionRateScope" AS ENUM ('PER_JOBBER', 'TOTAL');
CREATE TYPE "MissionMediaType" AS ENUM ('IMAGE');
CREATE TYPE "MissionWeekday" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');
CREATE TYPE "MissionReviewChangeArea" AS ENUM (
  'TITLE', 'SERVICE', 'DESCRIPTION', 'LOCATION', 'PLANNING', 'WORKERS', 'PRICING', 'PHOTOS', 'OTHER'
);
CREATE TYPE "MissionRejectionReason" AS ENUM (
  'UNAUTHORIZED_SERVICE', 'DANGEROUS_REQUEST', 'ILLEGAL_REQUEST', 'INCONSISTENT_INFO', 'OUT_OF_SCOPE', 'OTHER'
);

ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'APPROVE_MISSION';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'REQUEST_MISSION_CHANGES';
ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'REJECT_MISSION';

ALTER TABLE "missions"
  ADD COLUMN IF NOT EXISTS "location_notes" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "scheduling_type" "MissionSchedulingType" NOT NULL DEFAULT 'ONCE',
  ADD COLUMN IF NOT EXISTS "schedule_start_date" DATE,
  ADD COLUMN IF NOT EXISTS "schedule_end_date" DATE,
  ADD COLUMN IF NOT EXISTS "schedule_same_hours_daily" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "selected_weekdays" "MissionWeekday"[] NOT NULL DEFAULT ARRAY[]::"MissionWeekday"[],
  ADD COLUMN IF NOT EXISTS "duration_known" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "pricing_type" "MissionPricingType" NOT NULL DEFAULT 'FIXED',
  ADD COLUMN IF NOT EXISTS "rate_amount" INTEGER,
  ADD COLUMN IF NOT EXISTS "rate_scope" "MissionRateScope" NOT NULL DEFAULT 'PER_JOBBER',
  ADD COLUMN IF NOT EXISTS "estimated_amount" INTEGER,
  ADD COLUMN IF NOT EXISTS "payment_confirmed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "submitted_for_review_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "review_internal_note" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "client_review_message" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "review_change_areas" "MissionReviewChangeArea"[] NOT NULL DEFAULT ARRAY[]::"MissionReviewChangeArea"[],
  ADD COLUMN IF NOT EXISTS "rejection_reason_code" "MissionRejectionReason",
  ADD COLUMN IF NOT EXISTS "rejection_reason_text" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "financial_follow_up_required" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "missions_status_submitted_for_review_at_idx"
  ON "missions" ("status", "submitted_for_review_at");
CREATE INDEX IF NOT EXISTS "missions_pricing_type_idx" ON "missions" ("pricing_type");
CREATE INDEX IF NOT EXISTS "missions_scheduling_type_idx" ON "missions" ("scheduling_type");

CREATE TABLE IF NOT EXISTS "mission_occurrences" (
  "id" UUID NOT NULL,
  "mission_id" UUID NOT NULL,
  "occurrence_date" DATE NOT NULL,
  "planned_start_at" TIMESTAMPTZ(6),
  "planned_end_at" TIMESTAMPTZ(6),
  "estimated_duration_minutes" INTEGER,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mission_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mission_occurrences_mission_id_occurrence_date_idx"
  ON "mission_occurrences" ("mission_id", "occurrence_date");

ALTER TABLE "mission_occurrences"
  ADD CONSTRAINT "mission_occurrences_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "mission_media" (
  "id" UUID NOT NULL,
  "mission_id" UUID NOT NULL,
  "media_type" "MissionMediaType" NOT NULL DEFAULT 'IMAGE',
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "uploaded_by_user_id" UUID NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mission_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mission_media_mission_id_sort_order_idx"
  ON "mission_media" ("mission_id", "sort_order");

ALTER TABLE "mission_media"
  ADD CONSTRAINT "mission_media_mission_id_fkey"
  FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mission_media"
  ADD CONSTRAINT "mission_media_uploaded_by_user_id_fkey"
  FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill : missions déjà PUBLISHED conservent FIXED + ONCE ; scheduledStartAt inchangé.
