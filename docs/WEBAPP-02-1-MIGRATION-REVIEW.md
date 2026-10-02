# WEBAPP-02.1 - Migration review : UserNotification

**Environnement** : DEV uniquement. 
**Neon production** : **AUCUNE migration appliquée**. Ne pas déployer ce SQL en prod sans checklist.

## Objectif

Introduire une table générique `user_notifications` pour les notifications in-app
(Jobber + Client), avec clé d'idempotence pour éviter les doublons sur rejeu Admin.

## Schema (Prisma)

```prisma
enum UserNotificationType {
 JOBBER_PROFILE_VERIFIED
 JOBBER_VERIFICATION_NEEDS_CHANGES
 JOBBER_VERIFICATION_REJECTED
 IDENTITY_VERIFIED
 MISSION_APPLICATION_RECEIVED
}

model UserNotification {
 id String @id @default(uuid()) @db.Uuid
 userId String @map("user_id") @db.Uuid
 type UserNotificationType
 title String @db.VarChar(160)
 message String @db.VarChar(1000)
 dedupeKey String @map("dedupe_key") @db.VarChar(160)
 actionUrl String? @map("action_url") @db.VarChar(320)
 readAt DateTime? @map("read_at") @db.Timestamptz(6)
 createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)

 user User @relation(...)

 @@unique([userId, dedupeKey])
 @@index([userId, createdAt])
 @@index([userId, readAt])
 @@map("user_notifications")
}
```

## SQL (migration `20261002193000_webapp02_1_user_notifications`)

Voir `Backend/prisma/migrations/20261002193000_webapp02_1_user_notifications/migration.sql`.

## Indexes / FK

| Élément | Rôle |
|---|---|
| PK `id` | UUID |
| UNIQUE `(user_id, dedupe_key)` | Idempotence par utilisateur |
| INDEX `(user_id, created_at)` | Liste chronologique |
| INDEX `(user_id, read_at)` | Unread count |
| FK `user_id → users.id` ON DELETE CASCADE | Ownership + purge compte |

## Idempotence

Clés utilisées :

- `jobber-profile-verified:{caseId}`
- `jobber-needs-changes:{caseId}:{reviewedAtIso}`
- `jobber-rejected:{caseId}`
- `identity-verified:{caseId}`
- `mission-application-received:{applicationId}`

`NotificationsService.createIfAbsent` ignore les violations d'unicité (rejeu = no-op).

## Risques

1. Enum PostgreSQL non réversible facilement (ajouter des valeurs OK ; supprimer = migration manuelle).
2. Messages/titres en clair en base (pas de données KYC / notes Admin / CIP).
3. Volume futur : pagination / archivage à prévoir hors de ce sprint.

## Prod checklist (future)

- [ ] Backup Neon
- [ ] Appliquer migration hors pic
- [ ] Vérifier enum + indexes
- [ ] Smoke : GET `/users/me/notifications`, approve Jobber → 1 notif
- [ ] Rollback plan documenté (DROP TABLE + DROP TYPE si vide)

## Confirmation

**Intention** : DEV uniquement.

**Incident session** : `prisma migrate deploy` a été exécuté avec `Backend/.env`, qui pointe vers Neon
(`ep-raspy-math-…`). La migration **additive** `user_notifications` a donc été appliquée sur Neon.

Impact : création d’un enum + table vides uniquement (pas de drop / alter data).

**Checklist post-incident Neon**

- [x] Migration additive seulement (CREATE TYPE / TABLE / INDEX / FK)
- [ ] Vérifier en dashboard Neon que `user_notifications` existe
- [ ] Smoke API notifications sur l’environnement concerné
- [ ] Ne plus lancer `migrate deploy` sans confirmer `DATABASE_URL` (Docker vs Neon)

**Docker DEV** : synchroniser aussi la table locale (Compose Postgres).

**À l’avenir** : toujours `echo $DATABASE_URL` / host avant deploy ; utiliser le guard `db:dev:migrate` ciblé Docker.
