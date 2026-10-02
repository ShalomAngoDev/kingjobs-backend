# Missions multi-Jobber

**BO05** : `workersNeeded` (1-50) + affectations ACTIVE = places pourvues.

## Compteurs (`computeStaffing`)

| Champ | Calcul |
| --- | --- |
| `workersNeeded` | `max(1, mission.workersNeeded)` |
| `filledWorkers` | nombre d'`MissionAssignment` `ACTIVE` |
| `remainingWorkers` | `max(0, needed - filled)` |
| `isFull` | `remainingWorkers === 0` |

Candidature refusée si `isFull` (même Mission encore `PUBLISHED` le temps d'une race : la sélection gère le verrou).

## Sélection progressive

- Tant que `remainingWorkers > 0` : Mission reste `PUBLISHED` ; chaque select crée une affectation ; les autres candidatures restent `PENDING`.
- Dernière place : `PENDING` restantes → `MISSION_FILLED` ; Mission `PUBLISHED` → `APPLICATION_SELECTED` → `CONFIRMED` si `paymentConfirmedAt` (ou `publishedAt`) présent.
- **Jamais** `PAYMENT_REQUIRED` après sélection lorsque le paiement publication est déjà confirmé (flux BO04+).

## Exemples

| workersNeeded | Selects | Résultat |
| --- | --- | --- |
| 1 | 1 OK, 2e → 409 | Pleine ; autres apps `MISSION_FILLED` |
| 10 | 10 OK, 11e → 409 | Pleine après le 10e |

## Annulation d'affectation

Libère une place. Si Mission était confirmée / sélection complète et `filled < needed` : retour `PUBLISHED` pour recruter à nouveau.

## Admin UI

Section **Candidatures & affectations** : recherchées / sélectionnées / restantes / nombre de candidatures + tableau (Jobber, statut, selectedAt, statut affectation). Pas de pièces KYC.

## Seed démo

`npm run db:seed:demo:applications` (development uniquement, guard `seed-demo`).
