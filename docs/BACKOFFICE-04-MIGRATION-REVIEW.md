# BACK-OFFICE 04 — revue migration (Neon prod : NE PAS APPLIQUER automatiquement)

Migration BO04 : `20261002160000_bo04_mission_review_v2`

## BO04.1

**Aucune nouvelle migration Prisma.** `rateScope` (`PER_JOBBER` | `TOTAL`) et colonnes pricing existent déjà. Les montants `workerGrossAmount` / `estimatedTotalAmount` sont **calculés** (`mission-pricing.ts`), pas persistés en doublon.

Neon **production** reste intact (aucune commande apply prod).

## Résumé BO04 (rappel)

Évolution additive : planning, tarification, médias, revue KingJOBS.

Voir `MISSION-CREATION-V2.md` et `MISSION-REVIEW.md` pour le contrat BO04.1.

## Enums

| Enum | Valeurs |
| --- | --- |
| `MissionStatus` (add) | `PENDING_REVIEW`, `NEEDS_CHANGES`, `REJECTED` |
| `MissionSchedulingType` | `ONCE`, `CONSECUTIVE_DAYS`, `SELECTED_DAYS` |
| `MissionPricingType` | `FIXED`, `HOURLY`, `DAILY` |
| `MissionRateScope` | `PER_JOBBER`, `TOTAL` |
| `MissionMediaType` | `IMAGE` |
| `MissionWeekday` | `MON` … `SUN` |
| `MissionReviewChangeArea` | `TITLE`, `SERVICE`, … |
| `MissionRejectionReason` | `UNAUTHORIZED_SERVICE`, … |
| `AdminAuditAction` (add) | `APPROVE_MISSION`, `REQUEST_MISSION_CHANGES`, `REJECT_MISSION` |

## Colonnes `missions` (defaults / nullable)

Planning, tarification, revue, paiement publication (`payment_confirmed_at`, `submitted_for_review_at`), messages Admin, `financial_follow_up_required`.

## Nouvelles tables

- `mission_occurrences` (créneaux, max 31 en V1)
- `mission_media` (photos, clé storage privée, pas de base64)

## Backfill

Missions existantes : `scheduling_type = ONCE`, `pricing_type = FIXED`, champs revue vides. Aucune conversion `prelaunch_missions`.

## Compatibilité Backend 04

- `PAYMENT_REQUIRED` après sélection Jobber **legacy** si `published_at` déjà défini et pas de paiement publication : `markPaymentConfirmed` → `CONFIRMED`.
- Nouveau flux : `PAYMENT_REQUIRED` (sans `published_at`) → `PENDING_REVIEW` après paiement interne.
- Sélection Jobber : si `payment_confirmed_at` présent → `CONFIRMED` direct (plus de second paiement).

## Risques

- Ordre enum PostgreSQL (valeurs ajoutées, pas de réordonnancement).
- Missions historiques en `PUBLISHED` sans `payment_confirmed_at` : sélection peut encore passer par `PAYMENT_REQUIRED` legacy.

## SQL

Voir `prisma/migrations/20261002160000_bo04_mission_review_v2/migration.sql`.

## Actions manuelles

1. `npm run db:migrate:deploy` sur **development** / Docker local uniquement.
2. `npm run db:seed:demo:missions` (optionnel, dev).
3. Rebuild API + Web, recharger `/admin/missions`.
