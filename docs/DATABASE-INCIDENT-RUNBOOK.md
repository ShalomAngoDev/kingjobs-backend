# Database Incident Runbook — KingJOBS

## Principes

1. **Ne pas paniquer.**
2. **Ne jamais** lancer `prisma migrate reset` / `db push --force-reset` / `DROP DATABASE` sur production.
3. Préserver l’état actuel (snapshot / branche Neon si disponible).
4. Diagnostiquer avant de « réparer ».

---

## Cas A — Migration `deploy` échoue sur Render

1. Lire les logs Render (message Prisma P30xx).
2. `npm run db:status` en local **ne doit pas** utiliser la prod sans `DATABASE_ENV=production`.
3. Vérifier `_prisma_migrations` (migrations appliquées / failed).
4. Si migration **failed** partiellement : ne pas reset — corriger le SQL, `migrate resolve` selon doc Prisma, ou restauration Neon.
5. Redeploy uniquement après SQL validé.

## Cas B — Table manquante / schéma divergent

1. Stopper les writes applicatifs si critique (maintenance Render).
2. Lister tables (`\dt`) — **sans** DROP.
3. Comparer avec `schema.prisma` + dossier `migrations/`.
4. Si données perdues : restore Neon (PITR / branche) **si le plan le permet**.
5. Recréer tables pré-lancement seulement à partir de `docs/DATABASE.md` (comme après l’incident B04).
6. Ré-appliquer seed catalogue (`db:seed` avec `DATABASE_ENV=production`) si nécessaire.

## Cas C — Mauvaise migration déployée

1. Ne pas reset.
2. Écrire une **nouvelle** migration corrective additive.
3. Tester sur branche Neon development.
4. `db:migrations:check` + revue humaine.
5. `db:prod:deploy`.

## Cas D — Production inaccessible

1. Status Neon + Render.
2. Vérifier `DATABASE_URL` / `DIRECT_URL` (sans coller les secrets dans un chat).
3. Health : `/api/v1/health/ready`.
4. Escalade infra si compute suspendu.

## Cas E — Suspicion d’usage shadow = prod

1. Vérifier historique shell / CI pour `--shadow-database-url`.
2. Confirmer intégrité tables critiques + pré-lancement.
3. Restore si besoin.
4. Révoquer/rotation credentials si exposition.
5. S’assurer que `SHADOW_DATABASE_URL` local pointe vers branche dédiée.

## Cas F — Divergence Prisma Client / DB

1. `prisma validate` + `prisma generate`.
2. `migrate status` (avec env correct).
3. Ne pas `db push` en prod.

---

## Contacts / responsabilités

- Développeur : diagnostic, migration corrective, tests.
- Ops : restore Neon, variables Render, freeze deploy.

## Post-incident

- Mettre à jour ce runbook.
- Ajouter un marqueur host dans `KINGJOBS_PROD_DB_HOSTS` si nouvel endpoint.
- Rotation secrets si fuite.
