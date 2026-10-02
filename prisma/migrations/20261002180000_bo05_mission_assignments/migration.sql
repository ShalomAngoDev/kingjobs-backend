-- BO05 — MissionAssignment multi-Jobber + clôture candidatures
-- Additive. Backfill legacy selected_jobber_user_id → assignment ACTIVE.
-- Ne pas exécuter sur Neon production sans revue humaine (BACKOFFICE-05-MIGRATION-REVIEW.md).

ALTER TYPE "MissionApplicationStatus" ADD VALUE IF NOT EXISTS 'MISSION_FILLED';
ALTER TYPE "MissionApplicationStatus" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_CANCELLED';

DO $$ BEGIN
  CREATE TYPE "MissionAssignmentStatus" AS ENUM ('ACTIVE', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "mission_applications"
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "mission_assignments" (
  "id" UUID NOT NULL,
  "mission_id" UUID NOT NULL,
  "jobber_user_id" UUID NOT NULL,
  "application_id" UUID NOT NULL,
  "status" "MissionAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "selected_at" TIMESTAMPTZ(6) NOT NULL,
  "selected_by_user_id" UUID NOT NULL,
  "cancelled_at" TIMESTAMPTZ(6),
  "cancellation_reason" VARCHAR(500),
  "worker_gross_amount" INTEGER NOT NULL,
  "commission_rate_bps" INTEGER NOT NULL DEFAULT 1500,
  "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "mission_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "mission_assignments_application_id_key"
  ON "mission_assignments" ("application_id");

-- Une seule affectation ACTIVE par (mission, jobber).
CREATE UNIQUE INDEX IF NOT EXISTS "mission_assignments_mission_jobber_active_uidx"
  ON "mission_assignments" ("mission_id", "jobber_user_id")
  WHERE "status" = 'ACTIVE';

CREATE INDEX IF NOT EXISTS "mission_assignments_mission_id_status_idx"
  ON "mission_assignments" ("mission_id", "status");

CREATE INDEX IF NOT EXISTS "mission_assignments_jobber_user_id_status_idx"
  ON "mission_assignments" ("jobber_user_id", "status");

DO $$ BEGIN
  ALTER TABLE "mission_assignments"
    ADD CONSTRAINT "mission_assignments_mission_id_fkey"
    FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "mission_assignments"
    ADD CONSTRAINT "mission_assignments_jobber_user_id_fkey"
    FOREIGN KEY ("jobber_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "mission_assignments"
    ADD CONSTRAINT "mission_assignments_application_id_fkey"
    FOREIGN KEY ("application_id") REFERENCES "mission_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "mission_assignments"
    ADD CONSTRAINT "mission_assignments_selected_by_user_id_fkey"
    FOREIGN KEY ("selected_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill : Missions avec selected_jobber_user_id sans assignment ACTIVE.
-- worker_gross_amount approximé : client_price_amount / GREATEST(workers_needed, 1) si divisible, sinon client_price_amount.
INSERT INTO "mission_assignments" (
  "id",
  "mission_id",
  "jobber_user_id",
  "application_id",
  "status",
  "selected_at",
  "selected_by_user_id",
  "worker_gross_amount",
  "commission_rate_bps",
  "currency",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  m.id,
  m.selected_jobber_user_id,
  COALESCE(
    (
      SELECT a.id
      FROM mission_applications a
      WHERE a.mission_id = m.id
        AND a.jobber_user_id = m.selected_jobber_user_id
        AND a.status = 'SELECTED'
      ORDER BY a.selected_at ASC NULLS LAST
      LIMIT 1
    ),
    (
      SELECT a.id
      FROM mission_applications a
      WHERE a.mission_id = m.id
        AND a.jobber_user_id = m.selected_jobber_user_id
      ORDER BY a.applied_at ASC
      LIMIT 1
    )
  ),
  'ACTIVE',
  COALESCE(m.assigned_at, m.updated_at, m.created_at),
  m.client_user_id,
  CASE
    WHEN m.workers_needed > 0 AND m.client_price_amount % m.workers_needed = 0
      THEN m.client_price_amount / m.workers_needed
    ELSE m.client_price_amount
  END,
  1500,
  m.currency,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM missions m
WHERE m.selected_jobber_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM mission_assignments ma
    WHERE ma.mission_id = m.id
      AND ma.jobber_user_id = m.selected_jobber_user_id
      AND ma.status = 'ACTIVE'
  )
  AND (
    EXISTS (
      SELECT 1 FROM mission_applications a
      WHERE a.mission_id = m.id AND a.jobber_user_id = m.selected_jobber_user_id
    )
  );
