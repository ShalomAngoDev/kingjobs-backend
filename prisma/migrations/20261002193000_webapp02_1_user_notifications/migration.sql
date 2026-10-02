-- WEBAPP-02.1 : UserNotification (DEV uniquement ; pas Neon prod sans checklist).
-- Voir Backend/docs/WEBAPP-02-1-MIGRATION-REVIEW.md

CREATE TYPE "UserNotificationType" AS ENUM (
  'JOBBER_PROFILE_VERIFIED',
  'JOBBER_VERIFICATION_NEEDS_CHANGES',
  'JOBBER_VERIFICATION_REJECTED',
  'IDENTITY_VERIFIED',
  'MISSION_APPLICATION_RECEIVED'
);

CREATE TABLE "user_notifications" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" "UserNotificationType" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "message" VARCHAR(1000) NOT NULL,
  "dedupe_key" VARCHAR(160) NOT NULL,
  "action_url" VARCHAR(320),
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_notifications_user_id_dedupe_key_key"
  ON "user_notifications"("user_id", "dedupe_key");

CREATE INDEX "user_notifications_user_id_created_at_idx"
  ON "user_notifications"("user_id", "created_at");

CREATE INDEX "user_notifications_user_id_read_at_idx"
  ON "user_notifications"("user_id", "read_at");

ALTER TABLE "user_notifications"
  ADD CONSTRAINT "user_notifications_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
