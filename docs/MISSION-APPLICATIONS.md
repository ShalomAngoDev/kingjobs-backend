# Candidatures Mission (MissionApplication)

**BO05** : multi-sélection, clôture `MISSION_FILLED`, lien optionnel vers `MissionAssignment`.

Voir aussi : `MISSION-ASSIGNMENTS.md`, `MULTI-JOBBER-MISSIONS.md`, `MISSIONS-LIFECYCLE.md`.

## Rôle

Une **candidature** est la manifestation d'intérêt d'un Jobber éligible sur une Mission `PUBLISHED`. Elle n'est **pas** une affectation : la sélection crée (ou réutilise) une `MissionAssignment`.

## Statuts

| Statut | Signification |
| --- | --- |
| `PENDING` | En attente de décision Client |
| `WITHDRAWN` | Retirée par le Jobber |
| `SELECTED` | Retenue ; une affectation ACTIVE doit exister |
| `REJECTED` | Refusée explicitement par le Client |
| `MISSION_FILLED` | Clôturée car l'effectif est complet (pas un rejet personnel) |
| `ASSIGNMENT_CANCELLED` | Affectation annulée après sélection |

Champ `closedAt` : renseigné pour `MISSION_FILLED` et `ASSIGNMENT_CANCELLED`.

## Flux Jobber

1. `POST /missions/:id/applications` si Mission `PUBLISHED`, places restantes > 0, éligibilité OK.
2. Retrait : `POST …/applications/:applicationId/withdraw` si `PENDING`.
3. Impossible de retirer une candidature `SELECTED` : annuler l'affectation / la Mission selon les règles métier.

## Flux Client

1. Liste : `GET /missions/:id/applications` (champs publics Jobber uniquement).
2. Sélection : `POST /missions/:missionId/applications/:applicationId/select` (multi-places, voir `MULTI-JOBBER-MISSIONS.md`).
3. Refus explicite d'une `PENDING` (sans remplir les places) : endpoint reject dédié.

## Admin

`GET /admin/missions/:id` expose `applications[]` (avec `assignment` si présente), `applicationsCount`, compteurs staffing.

## Confidentialité

La liste candidatures n'expose **pas** email, téléphone, date de naissance, hash. Admin : identité Client complète ; Jobbers via résumé public + pas de docs KYC sur cette vue.
