-- Additive: workers_needed on missions (default 1 for historical rows)
ALTER TABLE "missions" ADD COLUMN IF NOT EXISTS "workers_needed" INTEGER NOT NULL DEFAULT 1;

-- Catalogue Renfort & Opérations is seeded via upsert (no SQL inserts of categories/services here)
-- Seed remains source of truth for catalog rows.
