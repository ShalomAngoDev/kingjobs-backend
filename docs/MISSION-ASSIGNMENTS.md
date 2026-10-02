# Affectations Mission (MissionAssignment)

**BO05** : table `mission_assignments`. Une affectation = un Jobber **sélectionné** pour une place sur une Mission.

## Pourquoi une table distincte ?

- Une candidature peut exister sans affectation (`PENDING`, `REJECTED`, `MISSION_FILLED`).
- Plusieurs Jobbers peuvent être affectés (`workersNeeded` > 1).
- Snapshot financier figé à la sélection (`workerGrossAmount`, `commissionRateBps`, `currency`) pour le futur payout.
- Annulation d'un slot sans supprimer l'historique candidature.

## Statuts

| Statut | Signification |
| --- | --- |
| `ACTIVE` | Place pourvue (compte pour `filledWorkers`) |
| `CANCELLED` | Slot libéré (`cancelledAt`, `cancellationReason`) |

Contrainte : **au plus une** affectation `ACTIVE` par couple `(missionId, jobberUserId)` (index partiel SQL).

Relation 1-1 : `applicationId` unique (une candidature sélectionnée → une affectation).

## Création

Via `MissionLifecycleService.selectApplication` :

1. Verrou mission (`SELECT … FOR UPDATE`).
2. Garde places restantes (`computeStaffing`).
3. `PENDING` → `SELECTED` + création `ACTIVE`.
4. Si effectif complet : clôture `PENDING` → `MISSION_FILLED`, puis transitions Mission (voir lifecycle).

## Annulation

`POST /missions/:missionId/assignments/:assignmentId/cancel` :

- Client propriétaire ou Jobber affecté.
- `ACTIVE` → `CANCELLED` ; candidature → `ASSIGNMENT_CANCELLED`.
- Si Mission était pleine (`APPLICATION_SELECTED` / `CONFIRMED`) et places libres : retour `PUBLISHED`.

## Legacy

`missions.selected_jobber_user_id` reste synchronisé (premier ACTIVE) pour START/END V1. Backfill SQL BO05 crée une affectation ACTIVE pour les missions legacy qui avaient déjà un Jobber sélectionné avec candidature.
