# USER-WEB-AUTH — Authentification Web App Client / Jobber

## Architecture

```
Browser
  → Next.js WebSite (BFF User, cookies httpOnly kj_user_*)
  → Backend NestJS (/api/v1/auth, /users, /clients, /jobbers)
  → PostgreSQL
```

Pas d'accès Prisma/Neon depuis les pages User. Distinct de `/admin` (cookies `kj_admin_*`, path `/admin`).

## Register

`POST /api/v1/auth/register`

| Champ | Obligatoire | Notes |
| --- | --- | --- |
| firstName | oui | |
| lastName | oui | |
| countryCode | oui | `BJ` \| `CI` \| `TG` (ISO alpha-2) |
| phone | oui | Normalisé E.164 selon countryCode |
| email | non | Jamais d'email synthétique |
| password | oui | Argon2id, min 8 caractères |
| acceptTerms | oui | Enregistre `TermsAcceptance` (version `TERMS_VERSION` = 1.0) |
| dateOfBirth | non | Complétion profil ultérieure (âge 16+) |

Pays supportés V1 : Bénin (+229), Côte d'Ivoire (+225), Togo (+228).
Config : `common/constants/supported-countries.ts`.

Effets :
- Crée `User` avec `countryCode` + `phone` E.164 (pas de Client/Jobber profile).
- `phoneVerifiedAt` reste null.
- Émet access + refresh (session immédiate).

## Login

`POST /api/v1/auth/login`

- User Web : `{ phone, password, countryCode? }`
- Admin : `{ email, password }` (rétrocompatible)

Erreur générique User : « Numéro de téléphone ou mot de passe incorrect. »

## Normalisation téléphone

`normalizePhoneToE164(input, BJ)` via `libphonenumber-js`.
Unicité DB sur la valeur E.164 (`users.phone` UNIQUE).

## Email facultatif

`email` / `emailNormalized` nullable + unique lorsque présent.
Conséquence : notifications transactionnelles doivent tolérer l'absence d'email (SMS/push plus tard).

## Activation profils

- `POST /api/v1/clients/me/activate` — lazy ClientProfile (idempotent)
- `POST /api/v1/jobbers/me/activate` — JobberProfile DRAFT (idempotent)

Un seul User peut avoir les deux profils. Choix = parcours, pas identité irréversible.

## WEBAPP-01.1 — Explore first

`GET /missions/available` liste les Missions **PUBLISHED** pour tout Jobber activé
(même DRAFT / non vérifié). Filtres : serviceId, city, search, pricingType.

La vérification / éligibilité est contrôlée uniquement à
`POST /missions/:id/applications` (`assertUserCanOperateAsJobber` + ServiceRequirements).

Voir aussi `WebSite/docs/WEBAPP-01.1-JOBBER-SHELL.md`.

## Session

JWT access + refresh opaque rotatif (existant).
Web : cookies `kj_user_access` / `kj_user_refresh`, `httpOnly`, `SameSite=Lax`, `Secure` en prod, `path=/`.

## Logout

`POST /api/v1/auth/logout` + clear cookies → `/connexion`.

## Dette documentée

- Mot de passe oublié par SMS : non opérationnel → lien non exposé comme workflow fonctionnel.
- OTP téléphone : non branché en prod SMS.
- Création mission / liste missions web : hors WEBAPP-01.
