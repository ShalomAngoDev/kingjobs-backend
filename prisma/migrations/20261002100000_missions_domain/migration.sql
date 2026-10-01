-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'APPLICATION_SELECTED', 'PAYMENT_REQUIRED', 'CONFIRMED', 'READY_TO_START', 'IN_PROGRESS', 'COMPLETION_PENDING', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "MissionApplicationStatus" AS ENUM ('PENDING', 'WITHDRAWN', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MissionVerificationType" AS ENUM ('START_CODE', 'START_QR', 'END_CODE', 'END_QR');

-- CreateEnum
CREATE TYPE "MissionActorType" AS ENUM ('CLIENT', 'JOBBER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MissionCancellationReason" AS ENUM ('CLIENT_CHANGED_MIND', 'JOBBER_UNAVAILABLE', 'SCHEDULE_CONFLICT', 'UNSAFE_CONDITIONS', 'OTHER');

-- CreateEnum
CREATE TYPE "MissionIncidentType" AS ENUM ('JOBBER_NO_SHOW', 'CLIENT_NO_SHOW', 'SAFETY', 'SERVICE_QUALITY', 'PAYMENT', 'BEHAVIOR', 'OTHER');

-- CreateEnum
CREATE TYPE "MissionIncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MissionRiskFlag" AS ENUM ('DRIVING', 'ROAD_INTERVENTION', 'WORK_AT_HEIGHT', 'LIVE_ELECTRICAL_WORK', 'HEAVY_MACHINERY', 'HAZARDOUS_EQUIPMENT', 'NIGHT_SECURITY', 'OTHER_RESTRICTED_ACTIVITY');

-- CreateTable
CREATE TABLE "missions" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(32) NOT NULL,
    "client_user_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'BJ',
    "city" VARCHAR(120) NOT NULL,
    "district" VARCHAR(120),
    "address_line" VARCHAR(255),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "scheduled_start_at" TIMESTAMPTZ(6),
    "estimated_duration_minutes" INTEGER,
    "client_price_amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "minimum_age" INTEGER NOT NULL DEFAULT 16,
    "risk_flags" "MissionRiskFlag"[],
    "status" "MissionStatus" NOT NULL DEFAULT 'DRAFT',
    "selected_jobber_user_id" UUID,
    "service_name_snapshot" VARCHAR(120) NOT NULL,
    "service_slug_snapshot" VARCHAR(120) NOT NULL,
    "category_name_snapshot" VARCHAR(120) NOT NULL,
    "category_slug_snapshot" VARCHAR(120) NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "assigned_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "completion_requested_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "missions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_applications" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "jobber_user_id" UUID NOT NULL,
    "message" VARCHAR(1000),
    "status" "MissionApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawn_at" TIMESTAMPTZ(6),
    "selected_at" TIMESTAMPTZ(6),
    "rejected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mission_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_verifications" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "type" "MissionVerificationType" NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "used_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mission_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_cancellations" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "initiated_by_user_id" UUID NOT NULL,
    "actor_type" "MissionActorType" NOT NULL,
    "reason_code" "MissionCancellationReason" NOT NULL,
    "reason_text" VARCHAR(1000),
    "previous_status" "MissionStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_incidents" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "reported_by_user_id" UUID NOT NULL,
    "type" "MissionIncidentType" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "status" "MissionIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "blocks_mission" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "mission_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mission_status_history" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "from_status" "MissionStatus",
    "to_status" "MissionStatus" NOT NULL,
    "actor_user_id" UUID,
    "reason" VARCHAR(500),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mission_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "missions_reference_key" ON "missions"("reference");

-- CreateIndex
CREATE INDEX "missions_client_user_id_status_idx" ON "missions"("client_user_id", "status");

-- CreateIndex
CREATE INDEX "missions_selected_jobber_user_id_status_idx" ON "missions"("selected_jobber_user_id", "status");

-- CreateIndex
CREATE INDEX "missions_service_id_status_idx" ON "missions"("service_id", "status");

-- CreateIndex
CREATE INDEX "missions_status_published_at_idx" ON "missions"("status", "published_at");

-- CreateIndex
CREATE INDEX "missions_city_country_code_idx" ON "missions"("city", "country_code");

-- CreateIndex
CREATE INDEX "mission_applications_jobber_user_id_status_idx" ON "mission_applications"("jobber_user_id", "status");

-- CreateIndex
CREATE INDEX "mission_applications_mission_id_status_idx" ON "mission_applications"("mission_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mission_applications_mission_id_jobber_user_id_key" ON "mission_applications"("mission_id", "jobber_user_id");

-- CreateIndex
CREATE INDEX "mission_verifications_mission_id_type_used_at_idx" ON "mission_verifications"("mission_id", "type", "used_at");

-- CreateIndex
CREATE INDEX "mission_cancellations_mission_id_idx" ON "mission_cancellations"("mission_id");

-- CreateIndex
CREATE INDEX "mission_incidents_mission_id_status_idx" ON "mission_incidents"("mission_id", "status");

-- CreateIndex
CREATE INDEX "mission_incidents_status_idx" ON "mission_incidents"("status");

-- CreateIndex
CREATE INDEX "mission_status_history_mission_id_created_at_idx" ON "mission_status_history"("mission_id", "created_at");

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_client_user_id_fkey" FOREIGN KEY ("client_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_selected_jobber_user_id_fkey" FOREIGN KEY ("selected_jobber_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "missions" ADD CONSTRAINT "missions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_applications" ADD CONSTRAINT "mission_applications_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_applications" ADD CONSTRAINT "mission_applications_jobber_user_id_fkey" FOREIGN KEY ("jobber_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_verifications" ADD CONSTRAINT "mission_verifications_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_cancellations" ADD CONSTRAINT "mission_cancellations_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_cancellations" ADD CONSTRAINT "mission_cancellations_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_incidents" ADD CONSTRAINT "mission_incidents_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_incidents" ADD CONSTRAINT "mission_incidents_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mission_status_history" ADD CONSTRAINT "mission_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Séquence pour les références lisibles KJ-YYYY-NNNNNN (jamais count+1).
CREATE SEQUENCE IF NOT EXISTS "mission_reference_seq" START WITH 1 INCREMENT BY 1;
