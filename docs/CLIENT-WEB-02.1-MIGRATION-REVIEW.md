# CLIENT WEB 02.1 - Migration review

## Décision

**Aucune migration Prisma** n'est requise pour CLIENT WEB 02.1.

## Analyse

| Élément | Statut |
| --- | --- |
| `Mission.title` | Déjà `VarChar(160)` : accepte `TITLE_MAX=80` sans ALTER |
| `MissionMedia` / table `mission_media` | Déjà en place (BO04 / BO04.1) |
| Storage privé (BO03.1) | Réutilisé pour upload Client |
| Neon production | Intact (aucune migration auto) |

## Changements code (sans schéma)

- `MISSION_LIMITS.TITLE_MIN=5`, `TITLE_MAX=80`
- `POST /missions/:id/media`, `DELETE /missions/:id/media/:mediaId`
- `getDetail` CLIENT / JOBBER : `photos: [{id,mimeType,url}]`
- WebSite wizard : upload / delete + validation titre

## Procédure si migration future

1. DEV uniquement
2. Review manuelle
3. Jamais de migrate Neon production automatique depuis cet agent
