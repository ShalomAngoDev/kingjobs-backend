-- WEBAPP-01 — email facultatif + date de naissance nullable (complétion profil ultérieure)
-- Additive / backward compatible. Users existants conservent email + DOB.
-- Ne pas exécuter sur Neon production sans revue (WEBAPP-01-MIGRATION-REVIEW.md).

ALTER TABLE "users"
  ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "email_normalized" DROP NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "date_of_birth" DROP NOT NULL;
