# KingJOBS API

API centrale KingJOBS — **modular monolith NestJS**.

## Stack

- Node.js ≥ 20.19 · NestJS 11 · Prisma 6 · PostgreSQL/Neon
- Auth Backend 02 : JWT access + refresh rotatif · Argon2id · Resend · SMS abstrait

## Installation

```bash
cp .env.example .env
# DATABASE_ENV=development
# DATABASE_URL / DIRECT_URL = branche Neon **development**
# SHADOW_DATABASE_URL = branche Neon **shadow/test** (jamais la prod)
# JWT_ACCESS_SECRET (≥32 chars)
npm ci
npm run db:dev:generate
```

## Sécurité base de données (Backend 04.1)

**Lire avant toute migration :** [docs/DATABASE-SAFETY.md](docs/DATABASE-SAFETY.md)  
**Incidents :** [docs/DATABASE-INCIDENT-RUNBOOK.md](docs/DATABASE-INCIDENT-RUNBOOK.md)

```bash
npm run db:dev:migrate      # migrate dev + shadow guard
npm run db:migrations:check # scan SQL destructif
npm run db:prod:deploy      # migrate deploy (DATABASE_ENV requis)
npm run db:seed             # catalogue référence uniquement
```

**Ne jamais** utiliser Neon production comme shadow DB / test DB / `migrate reset`.

## Migration auth (Backend 02)

SQL : `prisma/migrations/20261001140000_auth_identity`  
Crée uniquement les tables identité/auth. **Ne touche pas** aux tables pré-lancement.

## Migration catalogue (Backend 03)

SQL : `prisma/migrations/20261001160000_service_catalog_jobber_eligibility`  
Catalogue, JobberService, zones, requirements — **additive only**.

```bash
npm run prisma:migrate:deploy
npm run prisma:seed   # 8 catégories / 35 services (idempotent)
```

Doc : **[docs/SERVICE-CATALOG-ELIGIBILITY.md](docs/SERVICE-CATALOG-ELIGIBILITY.md)**

## Migration missions (Backend 04)

SQL : `prisma/migrations/20261002100000_missions_domain`  
Tables missions / candidatures / vérifications / annulations / incidents / historique + séquence `mission_reference_seq`. **Additive only.**

Doc : **[docs/MISSIONS-LIFECYCLE.md](docs/MISSIONS-LIFECYCLE.md)** — aucun endpoint public de confirmation de paiement (Backend 05).

```bash
# Dev — générer sur branche development + shadow
npm run db:dev:migrate

# Prod Render — appliquer seulement
npm run db:prod:deploy
```

**Ne jamais** `prisma migrate reset` sur Neon partagé. Voir DATABASE-SAFETY.md.

## Dev

```bash
npm run dev   # :3001
```

## Endpoints clés

| | |
| --- | --- |
| Health | `GET /api/v1/health` |
| Auth | `POST /api/v1/auth/register\|login\|refresh\|logout…` |
| Me | `GET/PATCH /api/v1/users/me` |
| Jobber | `POST /api/v1/jobbers/me/activate` + services / zones / eligibility |
| Catalogue | `GET /api/v1/service-categories`, `GET /api/v1/services` |
| Admin catalogue | `POST/PATCH /api/v1/admin/service-categories\|services…` |
| Missions | `POST /api/v1/missions`, `…/publish`, `…/applications`, `…/verifications/*`, `…/incidents` |
| Admin missions | `GET /api/v1/admin/missions\|incidents…` |
| Docs | `/api/docs` (si `SWAGGER_ENABLED`) |

## Auth env

Voir `.env.example` : `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_WEB_URL`, `SMS_PROVIDER` (`console`\|`none`).

## Qualité

```bash
npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build
```

## Déploiement

Voir **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** :

- Web → **Vercel**
- API → **Render** (`render.yaml`)
- DB → **Neon** (même projet pour web + API)

```bash
# Build Render
npm ci && npm run build
# Pre-deploy
npm run prisma:migrate:deploy
# Start
npm run start:prod
```
