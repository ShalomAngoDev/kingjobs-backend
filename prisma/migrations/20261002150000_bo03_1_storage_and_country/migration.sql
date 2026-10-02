-- BACK-OFFICE 03.1 — Audit consultation documents KYC (additive)
-- Do NOT apply on Neon production until BO03 base migration is applied and GO.
--
-- country_code DEFAULT BJ : conservé pour compatibilité / marché Bénin.
-- Décision produit documentée dans BACKOFFICE-03-1-GO-NO-GO.md :
--   country_code = pays de résidence / adresse (pas nationalité).
--   Rendre nullable (DROP DEFAULT / DROP NOT NULL) est un follow-up explicite
--   après réconciliation baseline Neon (flaggé destructif par db-guard).

DO $$ BEGIN
  ALTER TYPE "AdminAuditAction" ADD VALUE IF NOT EXISTS 'VIEW_VERIFICATION_DOCUMENT';
EXCEPTION
  WHEN undefined_object THEN NULL;
  WHEN duplicate_object THEN NULL;
END $$;
