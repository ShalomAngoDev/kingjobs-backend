# KingJOBS API

API centrale KingJOBS — **modular monolith NestJS**.

## Stack

- Node.js ≥ 20.19 · NestJS 11 · Prisma 6 · PostgreSQL/Neon
- Auth Backend 02 : JWT access + refresh rotatif · Argon2id · Resend · SMS abstrait

## Installation

```bash
cp .env.example .env
# Renseigner DATABASE_URL, DIRECT_URL, JWT_ACCESS_SECRET (≥32 chars)
npm ci
npm run prisma:generate
```

## Migration auth (Backend 02)

SQL : `prisma/migrations/20261001140000_auth_identity`  
Crée uniquement les tables identité/auth. **Ne touche pas** aux tables pré-lancement.

```bash
# Dev (après review SQL)
npm run prisma:migrate:deploy

# Prod : revue manuelle puis
npm run prisma:migrate:deploy
```

**Non appliquée automatiquement sur Neon production** dans ce sprint.

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
| Jobber | `POST /api/v1/jobbers/me/activate` |
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
