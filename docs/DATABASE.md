# Database — KingJOBS API

## PostgreSQL / Neon

- Provider Prisma : `postgresql`
- Runtime : `DATABASE_URL` (idéalement pooled Neon)
- Migrations : `DIRECT_URL` (unpooled / direct Neon)
- Projet Neon existant partagé avec le site public

## Ownership actuel

| Zone | Ownership | Notes |
| --- | --- | --- |
| Tables `public` pré-lancement | APIs Next.js (`WebSite`) | Écriture active en production |
| Schéma `neon_auth.*` | Neon Auth (plateforme) | Hors scope Backend 01 — ne pas modifier |
| Futures tables métier | NestJS + Prisma Migrate | À partir des prochains sprints |

## Tables `public` détectées (noms)

1. `waitlist_subscribers`
2. `contact_messages`
3. `partnership_requests`
4. `prelaunch_mission_requests`

Toutes contiennent des **données personnelles (PII)** (email, nom, téléphone éventuel, messages).

Détail colonnes (sans données) :

### waitlist_subscribers

- `id` uuid PK default `gen_random_uuid()`
- `first_name` text null
- `email` text not null
- `email_normalized` text not null unique
- `status` text not null default `ACTIVE`
- `source` text null
- `created_at` timestamptz not null default `now()`

### contact_messages

- `id` uuid PK
- `name`, `email`, `subject`, `message` text not null
- `status` text default `NEW`
- `source` text default `website`
- `created_at` timestamptz
- index `created_at DESC`

### partnership_requests

- `id` uuid PK
- `first_name`, `last_name`, `email`, `organization`, `collaboration_type`, `message` not null
- `phone`, `role_title` null
- `status` default `NEW`, `source` default `website`
- `created_at` + index DESC

### prelaunch_mission_requests

- `id` uuid PK
- `first_name`, `last_name`, `phone`, `email`, `customer_type`, `description` not null
- `organization_name`, `service_id`, `other_service`, `city_or_area`, `desired_date` null
- `status` default `NEW`, `source` default `website`
- `created_at` + index DESC

## Stratégie Prisma (baseline)

Les tables pré-lancement ont été créées **hors** Prisma Migrate (SQL / console Neon).

Backend 01 :

1. Mappe ces tables dans `schema.prisma` via `@@map` (coexistence / documentation).
2. **Ne crée aucune migration** qui les recrée.
3. Dossier `prisma/migrations/` prêt pour les **futures** tables Nest.

Quand la première table métier Nest arrivera :

1. S'assurer que le schéma Prisma reflète l'existant (`db pull` si besoin, revue manuelle).
2. Baseline : marquer l'état actuel comme déjà appliqué (`prisma migrate resolve` / migration baseline vide) **sans** `DROP` / `reset`.
3. Ensuite seulement : `prisma migrate dev` pour les nouvelles tables.

## Interdits

- `prisma migrate reset`
- `db push` destructif sur la DB partagée
- `DROP TABLE` / `DROP DATABASE` automatisés
- Exécuter des tests contre la base de **production**

## Environnements

- **development** : branche Neon de dev ou DB locale
- **test** : DB test dédiée **ou** mocks Prisma (e2e Backend 01 utilise un mock)
- **production** : Neon prod — migrations uniquement via `migrate deploy` contrôlé

## Conventions futures

- Models Prisma : PascalCase
- Tables DB : snake_case + `@@map` / `@map`
- Timestamps : `createdAt` / `updatedAt` (ne pas réécrire les tables existantes juste pour harmoniser)
- Soft delete : décider modèle par modèle (pas de `deletedAt` global)

## Stockage fichiers

Ne pas stocker binaires lourds (pièces d'identité, photos) dans PostgreSQL par défaut — storage objet futur.
