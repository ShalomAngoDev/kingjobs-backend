# API Conventions — KingJOBS

## Base

- Prefixe : `/api`
- Version : `/v1`
- Exemple : `/api/v1/health`

## Style

- REST ressources, pluriels anglais (`/missions`, `/users`) quand les modules arriveront
- kebab-case dans les paths multi-mots
- JSON uniquement
- Dates : **ISO 8601** (UTC sérialisé)

## Status HTTP

Utiliser correctement : 200, 201, 204, 400, 401, 403, 404, 409, 422 (si choisi), 429, 500, 503.

Ne pas renvoyer 200 avec `success: false`.

## Erreurs

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "...",
  "path": "/api/v1/...",
  "timestamp": "2026-10-01T12:00:00.000Z",
  "requestId": "..."
}
```

## Request ID

Client peut envoyer `X-Request-Id` (UUID). Sinon généré. Toujours renvoyé.

## Pagination (future)

- Offset : `?page=1&limit=20` (limit max borné)
- Cursor : pour feeds si nécessaire

## Identifiants publics

UUID (non séquentiels).

## Versioning

Breaking changes → `v2`. Pas de breaking silencieux sur `v1`.

## Controllers vs services

- Controllers : HTTP / DTO / status
- Services : orchestration métier

## Pas d'enveloppe obligatoire

Réponses directes et lisibles (pas de wrapper `data/meta` géant sauf besoin listes paginées).
