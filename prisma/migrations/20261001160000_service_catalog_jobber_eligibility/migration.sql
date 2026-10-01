-- Backend 03 — catalogue services, JobberService, zones, requirements
-- Additive only. Does NOT touch pré-lancement tables
-- (waitlist_subscribers, contact_messages, partnership_requests, prelaunch_mission_requests).

-- CreateEnum
CREATE TYPE "JobberServiceStatus" AS ENUM (
  'DRAFT',
  'PENDING_ELIGIBILITY',
  'ELIGIBLE',
  'RESTRICTED',
  'SUSPENDED'
);

CREATE TYPE "ServiceRequirementType" AS ENUM (
  'MINIMUM_AGE',
  'DOCUMENT',
  'QUALIFICATION',
  'MANUAL_APPROVAL',
  'LEGAL_GUARDIAN_APPROVAL'
);

-- AlterTable jobber_profiles (extend, non-destructive)
ALTER TABLE "jobber_profiles" ADD COLUMN IF NOT EXISTS "headline" VARCHAR(160);
ALTER TABLE "jobber_profiles" ADD COLUMN IF NOT EXISTS "years_of_experience" INTEGER;

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "short_description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "minimum_age" INTEGER NOT NULL DEFAULT 16,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_types" (
    "id" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_types_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_requirements" (
    "id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "type" "ServiceRequirementType" NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500),
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "document_type_id" UUID,
    "configuration" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "service_requirements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobber_services" (
    "id" UUID NOT NULL,
    "jobber_profile_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "experience_description" VARCHAR(1000),
    "years_of_experience" INTEGER,
    "status" "JobberServiceStatus" NOT NULL DEFAULT 'PENDING_ELIGIBILITY',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobber_services_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobber_skills" (
    "id" UUID NOT NULL,
    "jobber_profile_id" UUID NOT NULL,
    "service_id" UUID,
    "scope_key" VARCHAR(40) NOT NULL DEFAULT 'profile',
    "name" VARCHAR(120) NOT NULL,
    "name_normalized" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobber_skills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobber_service_areas" (
    "id" UUID NOT NULL,
    "jobber_profile_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'BJ',
    "administrative_area" VARCHAR(120),
    "city" VARCHAR(120) NOT NULL,
    "district" VARCHAR(120),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "radius_km" DECIMAL(6,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobber_service_areas_pkey" PRIMARY KEY ("id")
);

-- Indexes & uniques
CREATE UNIQUE INDEX "service_categories_slug_key" ON "service_categories"("slug");
CREATE INDEX "service_categories_is_active_display_order_idx" ON "service_categories"("is_active", "display_order");

CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");
CREATE INDEX "services_category_id_is_active_display_order_idx" ON "services"("category_id", "is_active", "display_order");
CREATE INDEX "services_is_active_idx" ON "services"("is_active");

CREATE UNIQUE INDEX "document_types_code_key" ON "document_types"("code");
CREATE INDEX "document_types_is_active_idx" ON "document_types"("is_active");

CREATE UNIQUE INDEX "service_requirements_service_id_code_key" ON "service_requirements"("service_id", "code");
CREATE INDEX "service_requirements_service_id_is_active_idx" ON "service_requirements"("service_id", "is_active");

CREATE UNIQUE INDEX "jobber_services_jobber_profile_id_service_id_key" ON "jobber_services"("jobber_profile_id", "service_id");
CREATE INDEX "jobber_services_jobber_profile_id_status_idx" ON "jobber_services"("jobber_profile_id", "status");
CREATE INDEX "jobber_services_service_id_idx" ON "jobber_services"("service_id");

CREATE UNIQUE INDEX "jobber_skills_jobber_profile_id_name_normalized_scope_key_key" ON "jobber_skills"("jobber_profile_id", "name_normalized", "scope_key");
CREATE INDEX "jobber_skills_jobber_profile_id_idx" ON "jobber_skills"("jobber_profile_id");

CREATE INDEX "jobber_service_areas_jobber_profile_id_is_active_idx" ON "jobber_service_areas"("jobber_profile_id", "is_active");
CREATE INDEX "jobber_service_areas_country_code_city_idx" ON "jobber_service_areas"("country_code", "city");

-- ForeignKeys
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_requirements" ADD CONSTRAINT "service_requirements_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobber_services" ADD CONSTRAINT "jobber_services_jobber_profile_id_fkey" FOREIGN KEY ("jobber_profile_id") REFERENCES "jobber_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobber_services" ADD CONSTRAINT "jobber_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "jobber_skills" ADD CONSTRAINT "jobber_skills_jobber_profile_id_fkey" FOREIGN KEY ("jobber_profile_id") REFERENCES "jobber_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobber_skills" ADD CONSTRAINT "jobber_skills_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "jobber_service_areas" ADD CONSTRAINT "jobber_service_areas_jobber_profile_id_fkey" FOREIGN KEY ("jobber_profile_id") REFERENCES "jobber_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
