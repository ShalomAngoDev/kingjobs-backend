-- BACK-OFFICE 03 — Identity verification & profile validation (additive only)
-- Do NOT apply automatically on Neon production without review.

-- Enums (safe ADD VALUE)
ALTER TYPE "JobberStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CHANGES';
ALTER TYPE "IdentityVerificationStatus" ADD VALUE IF NOT EXISTS 'NEEDS_CHANGES';

DO $$ BEGIN
  CREATE TYPE "UserDocumentStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_CHANGES', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VerificationCaseKind" AS ENUM ('IDENTITY', 'JOBBER_PROFILE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VerificationCaseStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "JobberSkillKind" AS ENUM ('SKILL', 'QUALITY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IdentityDocumentSubType" AS ENUM ('CIP', 'PASSPORT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AdminAuditAction" AS ENUM (
    'VERIFY_DOCUMENT',
    'REJECT_DOCUMENT',
    'REQUEST_DOCUMENT_REPLACEMENT',
    'APPROVE_PROFILE',
    'REQUEST_PROFILE_CHANGES',
    'REJECT_PROFILE',
    'SERVICE_CREATED',
    'SERVICE_UPDATED',
    'SERVICE_ENABLED',
    'SERVICE_DISABLED',
    'SERVICE_CATEGORY_CHANGED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User address fields
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "address_line" VARCHAR(255);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "city" VARCHAR(120);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country_code" CHAR(2) NOT NULL DEFAULT 'BJ';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "administrative_area" VARCHAR(120);

CREATE INDEX IF NOT EXISTS "users_identity_verification_status_idx" ON "users"("identity_verification_status");
CREATE INDEX IF NOT EXISTS "users_country_code_city_idx" ON "users"("country_code", "city");

-- JobberSkill.kind
ALTER TABLE "jobber_skills" ADD COLUMN IF NOT EXISTS "kind" "JobberSkillKind" NOT NULL DEFAULT 'SKILL';
CREATE INDEX IF NOT EXISTS "jobber_skills_jobber_profile_id_kind_idx" ON "jobber_skills"("jobber_profile_id", "kind");

-- User languages
CREATE TABLE IF NOT EXISTS "user_languages" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code" VARCHAR(16) NOT NULL,
  "label" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_languages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_languages_user_id_code_key" ON "user_languages"("user_id", "code");
CREATE INDEX IF NOT EXISTS "user_languages_user_id_idx" ON "user_languages"("user_id");

DO $$ BEGIN
  ALTER TABLE "user_languages"
    ADD CONSTRAINT "user_languages_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Jobber educations
CREATE TABLE IF NOT EXISTS "jobber_educations" (
  "id" UUID NOT NULL,
  "jobber_profile_id" UUID NOT NULL,
  "institution" VARCHAR(160),
  "title" VARCHAR(160) NOT NULL,
  "field" VARCHAR(160),
  "started_on" DATE,
  "ended_on" DATE,
  "description" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "jobber_educations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "jobber_educations_jobber_profile_id_idx" ON "jobber_educations"("jobber_profile_id");

DO $$ BEGIN
  ALTER TABLE "jobber_educations"
    ADD CONSTRAINT "jobber_educations_jobber_profile_id_fkey"
    FOREIGN KEY ("jobber_profile_id") REFERENCES "jobber_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Jobber experiences
CREATE TABLE IF NOT EXISTS "jobber_experiences" (
  "id" UUID NOT NULL,
  "jobber_profile_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "organization" VARCHAR(160),
  "description" VARCHAR(1000),
  "started_on" DATE,
  "ended_on" DATE,
  "is_current" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "jobber_experiences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "jobber_experiences_jobber_profile_id_idx" ON "jobber_experiences"("jobber_profile_id");

DO $$ BEGIN
  ALTER TABLE "jobber_experiences"
    ADD CONSTRAINT "jobber_experiences_jobber_profile_id_fkey"
    FOREIGN KEY ("jobber_profile_id") REFERENCES "jobber_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Verification cases
CREATE TABLE IF NOT EXISTS "verification_cases" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" "VerificationCaseKind" NOT NULL,
  "status" "VerificationCaseStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_id" UUID,
  "user_message" VARCHAR(2000),
  "internal_note" VARCHAR(2000),
  "reason_code" VARCHAR(80),
  "resubmit_of_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "verification_cases_user_id_kind_status_idx" ON "verification_cases"("user_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "verification_cases_status_submitted_at_idx" ON "verification_cases"("status", "submitted_at");
CREATE INDEX IF NOT EXISTS "verification_cases_kind_status_idx" ON "verification_cases"("kind", "status");

DO $$ BEGIN
  ALTER TABLE "verification_cases"
    ADD CONSTRAINT "verification_cases_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "verification_cases"
    ADD CONSTRAINT "verification_cases_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "verification_cases"
    ADD CONSTRAINT "verification_cases_resubmit_of_id_fkey"
    FOREIGN KEY ("resubmit_of_id") REFERENCES "verification_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- User documents
CREATE TABLE IF NOT EXISTS "user_documents" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "document_type_id" UUID NOT NULL,
  "verification_case_id" UUID,
  "identity_sub_type" "IdentityDocumentSubType",
  "status" "UserDocumentStatus" NOT NULL DEFAULT 'PENDING',
  "storage_key" VARCHAR(512) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "original_filename" VARCHAR(255),
  "captured_at" TIMESTAMPTZ(6),
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMPTZ(6),
  "reviewed_by_id" UUID,
  "reason_code" VARCHAR(80),
  "user_message" VARCHAR(2000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "user_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_documents_user_id_status_idx" ON "user_documents"("user_id", "status");
CREATE INDEX IF NOT EXISTS "user_documents_document_type_id_status_idx" ON "user_documents"("document_type_id", "status");
CREATE INDEX IF NOT EXISTS "user_documents_verification_case_id_idx" ON "user_documents"("verification_case_id");
CREATE INDEX IF NOT EXISTS "user_documents_status_submitted_at_idx" ON "user_documents"("status", "submitted_at");

DO $$ BEGIN
  ALTER TABLE "user_documents"
    ADD CONSTRAINT "user_documents_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_documents"
    ADD CONSTRAINT "user_documents_document_type_id_fkey"
    FOREIGN KEY ("document_type_id") REFERENCES "document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_documents"
    ADD CONSTRAINT "user_documents_verification_case_id_fkey"
    FOREIGN KEY ("verification_case_id") REFERENCES "verification_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_documents"
    ADD CONSTRAINT "user_documents_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Document events
CREATE TABLE IF NOT EXISTS "user_document_events" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "actor_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_document_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_document_events_document_id_created_at_idx" ON "user_document_events"("document_id", "created_at");

DO $$ BEGIN
  ALTER TABLE "user_document_events"
    ADD CONSTRAINT "user_document_events_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "user_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "user_document_events"
    ADD CONSTRAINT "user_document_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Admin audit
CREATE TABLE IF NOT EXISTS "admin_audit_events" (
  "id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "action" "AdminAuditAction" NOT NULL,
  "resource_type" VARCHAR(80) NOT NULL,
  "resource_id" VARCHAR(80) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_audit_events_actor_id_created_at_idx" ON "admin_audit_events"("actor_id", "created_at");
CREATE INDEX IF NOT EXISTS "admin_audit_events_resource_type_resource_id_idx" ON "admin_audit_events"("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "admin_audit_events_action_created_at_idx" ON "admin_audit_events"("action", "created_at");

DO $$ BEGIN
  ALTER TABLE "admin_audit_events"
    ADD CONSTRAINT "admin_audit_events_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
