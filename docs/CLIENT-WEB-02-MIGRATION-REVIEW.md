# CLIENT WEB 02 - Migration review

## Décision

**Aucune migration Prisma** n'est requise pour CLIENT WEB 02.

## Analyse

| Élément | Statut |
| --- | --- |
| Mission / MissionOccurrence / pricing | Déjà en place (BO04 / BO04.1) |
| Identity User-level | Déjà en place |
| Nouveaux champs wizard | Mappés sur colonnes existantes |
| Neon production | Intact (aucune migration auto) |

## Changements Backend (code uniquement)

- `missions.service` `update` : rebuild des `MissionOccurrence` + `serviceId` en DRAFT / NEEDS_CHANGES
- `operational-gates` : code métier `IDENTITY_VERIFICATION_REQUIRED` sur refus Identity

Pas de changement de schéma.

## Procédure si migration future

1. DEV uniquement
2. Review manuelle
3. Jamais de migrate Neon production automatique depuis cet agent
