# Database Safety — KingJOBS API

## Incident Backend 04 (cause confirmée)

Pendant la génération de migration Backend 04, un
`prisma migrate diff --shadow-database-url <URL Neon production>`
a été exécuté en pointant la **shadow database** vers la même instance
`neondb` / endpoint production (`ep-orange-pine-za4ezsuf…`).

Prisma utilise la shadow DB pour appliquer les migrations depuis un état
vide afin de calculer un diff. Sur une URL production, cela peut
**réinitialiser / écraser** le schéma de cette base.

Conséquence observée : tables pré-lancement (`waitlist_subscribers`, etc.)
disparues ; ~2 inscriptions waitlist perdues ; tables recréées ensuite.

**Règle absolue :** ne jamais passer une URL production à
`--shadow-database-url` / `SHADOW_DATABASE_URL`.

---

## Environnements

| Rôle | `DATABASE_ENV` | Usage |
| --- | --- | --- |
| production | `production` | Render + Neon prod |
| development | `development` | Machine locale / branche Neon `development` |
| test | `test` | Branche Neon `test` (si DB réelle) ou e2e **in-memory** |

Fail-closed : `DATABASE_ENV` absent / DB inconnue → commandes dangereuses **refusées**.

---

## Neon — branches à créer (manuel)

Projet Neon **Kingjobs** :

1. **production** (actuelle) — données réelles  
2. **development** — migrations / `migrate dev`  
3. **shadow** (ou réutiliser `test`) — `SHADOW_DATABASE_URL` uniquement  
4. **test** (optionnel) — futurs e2e DB ; aujourd’hui les e2e missions sont mémoire

Actions humaines dans la console Neon :
- Create branch → copier pooled + direct URLs dans `.env` local  
- Ne jamais coller les URLs production dans `SHADOW_DATABASE_URL`

---

## Variables

Voir `.env.example` :

- `DATABASE_URL` / `DIRECT_URL`
- `SHADOW_DATABASE_URL` (obligatoire pour `db:dev:migrate` / `db:diff`)
- `TEST_DATABASE_URL` (optionnel)
- `DATABASE_ENV`
- `KINGJOBS_PROD_DB_HOSTS` (marqueurs hostname, sans secrets)
- `ALLOW_DESTRUCTIVE_MIGRATION` (override explicite, défaut off)

Prisma 6.19 : pas de `shadowDatabaseUrl` forcé dans `schema.prisma`
(évite d’exiger la var sur Render). Le guard passe
`--shadow-database-url` en CLI.

---

## Scripts npm

| Script | Rôle |
| --- | --- |
| `db:dev:migrate` | Guard + `migrate dev` + shadow |
| `db:diff` | Guard + `migrate diff` + shadow |
| `db:prod:deploy` | Exige `DATABASE_ENV` + `migrate deploy` |
| `db:test:reset` | Uniquement `DATABASE_ENV=test` |
| `db:migrations:check` | Scan SQL destructif |
| `db:seed` | Seed **catalogue** (référence, idempotent) |
| `db:status` | Affiche URLs **rédigées** |

Alias conservés : `prisma:migrate:dev` → `db:dev:migrate`, etc.

### Interdits via scripts

- `migrate reset` hors test  
- `db push --force-reset`  
- shadow = production  
- tests e2e si URL prod détectée  

---

## Workflow migration

```
dev branch Neon
  → modifier schema.prisma
  → npm run db:dev:migrate
  → inspecter SQL
  → npm run db:migrations:check
  → npm test && npm run test:e2e
  → commit
  → Render preDeploy: npm run db:prod:deploy
```

Production **applique** (`migrate deploy`), ne **génère** pas.

---

## Seed

`prisma/seed.ts` = **données de référence** (catégories / services / document types).

Pas de Users / Missions de démo en production.

---

## Render

- `DATABASE_ENV=production`
- `preDeployCommand`: `npm run db:prod:deploy`
- `startCommand`: `npm run start:prod` (pas de migrate/seed au boot)
- Pas de `SHADOW_*` / `TEST_*` sur Render

---

## Pre-flight (avant prod)

Voir checklist dans ce doc + runbook :

- [ ] migration générée sur **dev**
- [ ] SQL inspecté
- [ ] `db:migrations:check` OK
- [ ] tests + e2e OK
- [ ] `prisma validate` OK
- [ ] backup / branche Neon si migration sensible
- [ ] `DATABASE_ENV=production` sur Render
- [ ] aucune shadow production
- [ ] deploy = `migrate deploy` uniquement

---

## Recovery

Voir **[DATABASE-INCIDENT-RUNBOOK.md](./DATABASE-INCIDENT-RUNBOOK.md)**.

Capacités Neon (à vérifier sur le plan actuel) : Point-in-time recovery /
Instant restore / branches. Ne pas assumer sans console.

---

## Limites

Un développeur avec credentials SQL peut toujours exécuter des commandes
hors repo. Les garde-fous protègent les **workflows npm/Prisma du projet**.
