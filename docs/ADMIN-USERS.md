# Back-office 01 — Admin Users API

Préfixe : `/api/v1`. Tous les endpoints : JWT Bearer + `@Roles(ADMIN, SUPER_ADMIN)` (USER → 403).
Module : `src/modules/admin-users/`.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/admin/dashboard` | Compteurs agrégés (aucune ligne) |
| GET | `/admin/users` | Liste paginée + filtres |
| GET | `/admin/users/:id` | Détail + résumés `clientProfile` / `jobberProfile` |
| GET | `/admin/clients` | Users avec `ClientProfile` (+ `missionsCount`) |
| GET | `/admin/jobbers` | Users avec `JobberProfile` |
| GET | `/admin/jobbers/:id` | Détail Jobber (`:id` = **User.id**) |
| POST | `/admin/users/:id/suspend` | `{ reason }` (3–500 car.) → 200 |
| POST | `/admin/users/:id/reactivate` | SUSPENDED → ACTIVE → 200 |

Définitions : `missionsActive` = CONFIRMED + READY_TO_START + IN_PROGRESS + COMPLETION_PENDING ;
`incidentsOpen` = incidents `OPEN` + `UNDER_REVIEW`.

Règles de modération : pas d'auto-suspension (403) ; un ADMIN ne peut pas toucher un SUPER_ADMIN (403) ;
CLOSED → 422 ; déjà dans l'état cible → 409 ; inconnu → 404. La suspension révoque toutes les sessions
(`SessionsService.revokeAllUserSessions`) et journalise `admin_action=user.suspend|user.reactivate`
(Logger Nest — pas de table d'audit pour l'instant).

## CORS

Piloté par l'environnement (`src/common/utils/cors.ts`) : liste d'origines exactes + regex, jamais `*`,
`credentials: true`.

- `CORS_ORIGINS` : origines exactes séparées par des virgules. Défaut (si absent) :
  `http://localhost:3000,https://kingjobs.co,https://www.kingjobs.co`.
  **Attention** : dès que la variable est définie (ex. sur Render), elle remplace le défaut →
  y inclure `http://localhost:3000` en dev, et le domaine du back-office en prod.
- `CORS_ORIGIN_REGEXES` : défaut `^https://.*\.vercel\.app$` (previews Vercel).
