# Déploiement KingJOBS — Vercel + Render + Neon

## Architecture

```
Navigateur / Mobile
        │
        ├──────────────► Vercel (Next.js WebSite)
        │                      │
        │                      │ DATABASE_URL (Neon pooled)
        │                      ▼
        │                 Neon PostgreSQL
        │                      ▲
        │                      │ DATABASE_URL + DIRECT_URL
        └──────────────► Render (NestJS API)
```

- **Web** : Vercel → repo `kingjobs-web`
- **API** : Render → repo `kingjobs-backend` (`render.yaml`)
- **DB** : Neon projet `Kingjobs`, branche `production` (`quiet-dew-92164600`, région `aws-eu-west-2`)

Les formulaires pré-lancement restent sur les API Next.js + Neon.
L’auth Nest partage **la même** base Neon (tables `users`, `sessions`, …).

## 1. Neon

Console Neon → projet Kingjobs → Connection details :

| Usage | Variable | Type Neon |
| --- | --- | --- |
| Runtime API + Next | `DATABASE_URL` | **Pooled** (+ `sslmode=require`) |
| Migrations Prisma (Render preDeploy) | `DIRECT_URL` | **Direct / Unpooled** |

Copier les deux chaînes **sans les coller dans git**.

Appliquer la migration auth (une fois) depuis une machine de confiance ou via Render `preDeployCommand` :

```bash
cd Backend
# .env local avec DATABASE_URL + DIRECT_URL Neon
npm run prisma:migrate:deploy
```

SQL concerné : `prisma/migrations/20261001140000_auth_identity`  
(ne touche pas aux tables pré-lancement).

## 2. Render (API)

1. New → Blueprint → repo `ShalomAngoDev/kingjobs-backend`
2. Ou Web Service manuel :
   - **Build** : `npm ci && npm run build`
   - **Pre-Deploy** : `npm run prisma:migrate:deploy`
   - **Start** : `npm run start:prod`
   - **Health** : `/api/v1/health/live`
   - **Region** : Frankfurt (proche Neon Londres)
   - **Node** : `20.19.x` (`NODE_VERSION=20.19.0`)

3. Variables (dashboard) — obligatoires :

| Variable | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled |
| `DIRECT_URL` | Neon unpooled |
| `JWT_ACCESS_SECRET` | secret fort ≥ 32 chars (ou generateValue Render) |
| `CORS_ORIGINS` | `https://kingjobs.co,https://www.kingjobs.co` |
| `CORS_ORIGIN_REGEXES` | `^https://.*\.vercel\.app$` |
| `APP_WEB_URL` | `https://kingjobs.co` |
| `SMS_PROVIDER` | `none` (jusqu’au fournisseur SMS) |
| `SWAGGER_ENABLED` | `false` |
| `TRUST_PROXY` | `1` |
| `RESEND_API_KEY` | (optionnel) |
| `EMAIL_FROM` | `KingJOBS <hello@kingjobs.co>` |

`PORT` est injecté par Render — ne pas le forcer.

4. Après deploy, vérifier :

```bash
curl -s https://<service>.onrender.com/api/v1/health/live
curl -s https://<service>.onrender.com/api/v1/health
```

## 3. Vercel (Web)

Projet lié à `kingjobs-web`.

Variables Production / Preview :

| Variable | Valeur |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://kingjobs.co` |
| `DATABASE_URL` | **même** Neon pooled que Render |
| `DATABASE_URL_UNPOOLED` | Neon unpooled (si utilisé) |
| `NEXT_PUBLIC_KINGJOBS_API_URL` | `https://<service>.onrender.com` |
| `KINGJOBS_API_BASE_URL` | idem (SSR) |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `hello@kingjobs.co` |

Config code : `src/config/api.ts`.

Les routes `/api/waitlist|contact|partnership|prelaunch-missions` continuent d’écrire dans Neon depuis Vercel.

## 4. Checklist connexion

- [ ] Neon : pooled + unpooled copiés
- [ ] Render : service up, health live OK, health DB OK
- [ ] Render : migrate deploy OK (tables `users`, `sessions`, …)
- [ ] Vercel : `DATABASE_URL` = même projet Neon
- [ ] Vercel : `NEXT_PUBLIC_KINGJOBS_API_URL` = URL Render
- [ ] CORS : kingjobs.co + previews `*.vercel.app`
- [ ] Formulaires pré-lancement toujours OK sur le site
- [ ] `GET /api/v1` sur Render renvoie KingJOBS API

## 5. Domaine custom API (optionnel)

Plus tard : `api.kingjobs.co` → CNAME Render, puis mettre à jour `NEXT_PUBLIC_KINGJOBS_API_URL` et CORS.

## 6. Sécurité

- Jamais de secrets dans git
- Swagger off en prod
- SMS `none` en prod jusqu’à provider réel
- JWT secret unique et long
