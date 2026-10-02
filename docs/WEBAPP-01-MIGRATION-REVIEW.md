# WEBAPP-01 — Migration review : email facultatif + DOB nullable

## Contexte

Parcours Web App utilisateur : téléphone = identifiant principal, email facultatif.
La date de naissance n'est plus exigée à l'inscription (complétion profil ultérieure).

**Environnement cible :** développement uniquement (`DATABASE_ENV=development`).
**Interdit :** migration Neon production automatique.

Branche Neon utilisée en local (DEV) : `ep-raspy-math-…` (non production).
Production (`ep-orange-pine-…`) : **non touchée**.

---

## Schema avant

```prisma
email           String   @db.VarChar(320)
emailNormalized String   @unique @map("email_normalized") @db.VarChar(320)
dateOfBirth     DateTime @map("date_of_birth") @db.Date
phone           String   @unique @db.VarChar(20)
```

## Schema après

```prisma
email           String?   @db.VarChar(320)
emailNormalized String?   @unique @map("email_normalized") @db.VarChar(320)
dateOfBirth     DateTime? @map("date_of_birth") @db.Date
phone           String    @unique @db.VarChar(20)
```

Unicité :
- `phone` : UNIQUE (inchangé) — stocké E.164 après normalisation BJ.
- `email_normalized` : UNIQUE nullable (PostgreSQL autorise plusieurs NULL).

---

## SQL exact

Fichier : `prisma/migrations/20261002190000_webapp01_email_optional_dob_nullable/migration.sql`

```sql
ALTER TABLE "users"
  ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "email_normalized" DROP NOT NULL;

ALTER TABLE "users"
  ALTER COLUMN "date_of_birth" DROP NOT NULL;
```

Migration **additive** : DROP NOT NULL uniquement. Aucun DROP COLUMN, aucun backfill destructif.

---

## Backfill

Aucun. Les Users historiques conservent leur email et date de naissance.

Les nouveaux comptes Web peuvent avoir `email = NULL` et `date_of_birth = NULL`.

---

## Compatibilité Users historiques

- Comptes avec email + sans téléphone : inchangés (phone reste NOT NULL depuis Backend02 ; les seeds/admin ont un téléphone).
- Login Admin : continue via `email` / `emailNormalized`.
- Login User Web : via `phone` normalisé E.164.
- `phone NOT NULL` **non ajouté** de façon brutale : déjà en place ; pas de changement sur cette contrainte.

---

## Compatibilité Admin

- `/admin/login` : email + password (DTO Login accepte `email` OU `phone`).
- Sessions Admin / cookies `kj_admin_*` : inchangés.
- Promotion Admin : inchangée.

---

## Risques

| Risque | Mitigation |
| --- | --- |
| Workflows email sur User sans email | Register / forgot / verify skippe l'envoi si `email` null |
| Double compte même téléphone formats différents | `normalizePhoneToE164(…, BJ)` avant insert/lookup |
| Production Neon | Ne pas lancer `db:prod:deploy` sans revue humaine |

---

## Statut apply

- DEV Neon (`DATABASE_ENV=development`) : appliquée via `prisma migrate deploy` (WEBAPP-01).
- Production Neon : **intacte** (non déployée).
