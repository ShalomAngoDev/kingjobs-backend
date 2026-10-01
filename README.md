# KingJOBS API

API centrale KingJOBS — **modular monolith NestJS**.

Ce backend est indépendant du site Next.js. Les formulaires pré-lancement restent sur les API Next.js jusqu'à migration contrôlée.

## Stack

- Node.js **≥ 20.19** (LTS) — documenté dans `.nvmrc`
- NestJS 11
- TypeScript strict
- PostgreSQL / Neon
- Prisma 6
- class-validator / class-transformer
- Swagger (OpenAPI)
- Helmet, Throttler, CORS configurable

## Prérequis

- Node + npm
- Accès Neon (`DATABASE_URL` + `DIRECT_URL`)

## Installation

```bash
cd Backend
cp .env.example .env
# Renseigner DATABASE_URL et DIRECT_URL (Neon pooled + unpooled)
npm ci
npm run prisma:generate
```

## Lancement

```bash
npm run dev          # watch, port 3001 par défaut
npm run build && npm run start:prod
```

## Endpoints (Backend 01)

| Méthode | Chemin | Description |
| --- | --- | --- |
| GET | `/api/v1` | Métadonnées API |
| GET | `/api/v1/health` | Health + ping DB (`SELECT 1`) |
| GET | `/api/v1/health/live` | Liveness process |
| GET | `/api/v1/health/ready` | Readiness (DB) |
| GET | `/api/docs` | Swagger (si `SWAGGER_ENABLED=true`) |
| GET | `/api/docs-json` | OpenAPI JSON |

## Prisma

```bash
npm run prisma:generate
npm run prisma:validate
npm run prisma:migrate:dev    # futures migrations Nest uniquement
npm run prisma:migrate:deploy
npm run prisma:studio
```

**Ne jamais** lancer `prisma migrate reset` / `db push` destructif sur la base partagée avec le site public.

Voir `docs/DATABASE.md` (baseline / coexistence tables pré-lancement).

## Qualité

```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
```

## Documentation

- `docs/ARCHITECTURE.md`
- `docs/DATABASE.md`
- `docs/SECURITY.md`
- `docs/API-CONVENTIONS.md`
- `docs/PRELAUNCH-API-MIGRATION.md`

## Variables d'environnement

Voir `.env.example` (noms uniquement, jamais de secrets dans le dépôt).
