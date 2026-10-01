# Security — KingJOBS API (Backend 01)

## Secrets / env

- Jamais de secrets dans le code, README, Swagger, logs
- `.env` gitignoré ; `.env.example` = placeholders
- Validation au boot (`validateEnv`) — échec rapide si critique manquant

## CORS

- Origins explicites via `CORS_ORIGINS`
- Pas de `origin: '*'` avec `credentials: true`
- CORS = clients **navigateur** ; apps mobiles natives hors scope CORS

## Helmet

Activé au boot. CSP assouplie uniquement si Swagger est activé (UI docs).

## Validation

`ValidationPipe` global :

- `whitelist: true`
- `forbidNonWhitelisted: true`
- `transform: true`

## Rate limiting

`@nestjs/throttler` global (TTL/limit configurables).

- Health / meta : `@SkipThrottle()`
- Limite mémoire par instance — documenter le besoin Redis si multi-instance plus tard

## Trust proxy

`TRUST_PROXY` configurable (défaut `1`). À aligner avec le reverse proxy réel (IP / rate limit / HTTPS).

## Erreurs

Filtre global JSON. En production : pas de stack, SQL Prisma, chemins internes, credentials.

## Request ID

- Header `x-request-id` (UUID)
- Conservé s'il est un UUID valide, sinon généré
- Renvoyé dans la réponse

## Logs

- method, path, status, duration, requestId
- Redaction préparée (`SENSITIVE_LOG_KEYS`) : password, token, Authorization, cookie, DATABASE_URL, etc.

## Swagger

- `SWAGGER_ENABLED` (défaut off en production)
- Ne pas exposer publiquement sans décision explicite

## Body limit

`BODY_LIMIT` (défaut `1mb`). Uploads documents = stratégie dédiée future.

## Auth

Non implémentée (Backend 01). Architecture prête pour guards/decorators.

## Database

- Connexion via env uniquement
- Health : `SELECT 1` — jamais exposer l'URL ni le host dans les réponses
- Pas de tests contre la DB production
