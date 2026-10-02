# BACK-OFFICE 05 - Rapport revue migration

**Statut :** développement terminé, **migration NON appliquée sur Neon production**.

**Migration locale :** `Backend/prisma/migrations/20261002180000_bo05_mission_assignments/migration.sql`

## Périmètre SQL (additif)

### Enums

- `MissionApplicationStatus` += `MISSION_FILLED`, `ASSIGNMENT_CANCELLED`
- Nouveau : `MissionAssignmentStatus` (`ACTIVE`, `CANCELLED`)

### Colonnes

- `mission_applications.closed_at` (nullable)

### Table nouvelle

| Table | Rôle |
| --- | --- |
| `mission_assignments` | Affectations multi-Jobber + snapshot financier |

Index notables :

- unique `application_id`
- unique partiel `(mission_id, jobber_user_id) WHERE status = 'ACTIVE'`
- index `(mission_id, status)`, `(jobber_user_id, status)`

## Backfill

Pour chaque Mission avec `selected_jobber_user_id` **sans** affectation ACTIVE, et **avec** une candidature du même Jobber : insertion d'une ligne `ACTIVE` (montant brut approximé : `client_price_amount / workers_needed` si divisible, sinon total).

Les Missions sans candidature liée ne sont pas backfillées (évite FK orpheline).

## Environnements

| Env | Action |
| --- | --- |
| Docker / development local | `prisma migrate deploy` ou `db:dev:migrate` autorisé |
| Neon production | **Interdit dans ce sprint**. Revue humaine requise. Neon prod reste intact. |

## Risques

- Ordre enum PostgreSQL (`ADD VALUE IF NOT EXISTS`) : pas de réordonnancement.
- Concurrent selects : verrou `FOR UPDATE` + index unique ACTIVE.
- Missions legacy `PUBLISHED` sans `payment_confirmed_at` : sélection pleine peut encore passer par `PAYMENT_REQUIRED` (chemin legacy).
- Backfill : missions sélectionnées sans candidature restent sans assignment (à traiter manuellement si besoin).

## Checklist revue avant prod

1. Relire le SQL complet (enums + CREATE TABLE + backfill).
2. Snapshot / backup Neon.
3. Appliquer en fenêtre contrôlée (`migrate deploy` prod seulement après validation).
4. Smoke : apply → select multi → plein → `MISSION_FILLED` → cancel assignment → slot rouvert.
5. Vérifier admin détail : compteurs + tableau candidatures.
6. Seed démo uniquement en development : `db:seed:demo:applications`.

## Livrables code

- Backend : `MissionAssignment`, `computeStaffing`, select / cancel multi, serializers admin
- WebSite : section admin **Candidatures & affectations**
- Docs : `MISSION-APPLICATIONS.md`, `MISSION-ASSIGNMENTS.md`, `MULTI-JOBBER-MISSIONS.md`, `WebSite/docs/BACKOFFICE-05-APPLICATIONS.md`
- Tests : multi-select, `MISSION_FILLED`, cancel, pas de `PAYMENT_REQUIRED` si payé, `mission-staffing.spec.ts`

---

**BACK-OFFICE 05 DÉVELOPPEMENT TERMINÉ - AFFECTATIONS MULTI-JOBBER PRÊTES POUR REVUE MIGRATION**
