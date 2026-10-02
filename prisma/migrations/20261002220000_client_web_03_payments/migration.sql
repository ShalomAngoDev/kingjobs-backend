-- CLIENT WEB 03 — table payments (tentatives mock / futurs agrégateurs)
-- Appliquer en DEV local uniquement. Aucune migration Neon production automatique.

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED');

CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "mission_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XOF',
    "provider" VARCHAR(32) NOT NULL,
    "provider_reference" VARCHAR(120) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_provider_reference_key" ON "payments"("provider_reference");
CREATE INDEX "payments_mission_id_status_idx" ON "payments"("mission_id", "status");
CREATE INDEX "payments_user_id_created_at_idx" ON "payments"("user_id", "created_at");

ALTER TABLE "payments" ADD CONSTRAINT "payments_mission_id_fkey" FOREIGN KEY ("mission_id") REFERENCES "missions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
