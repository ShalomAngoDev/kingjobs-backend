# Migration des API pré-lancement (Next.js → NestJS)

## État actuel

```
Web Next.js
   │
   ├─ /api/waitlist
   ├─ /api/contact
   ├─ /api/partnership
   └─ /api/prelaunch-missions
          │
          ▼
     PostgreSQL Neon
```

Les 4 routes restent la source d'écriture en production pendant Backend 01.

## État transitoire (cible prochaine, pas Backend 01)

```
Next.js APIs ──────┐
                   ▼
                 Neon
                   ▲
NestJS API ────────┘   (lecture / nouveaux modules)
```

**Pas de double écriture** simultanément sur le même formulaire (risque de doublons).

## État final

```
Site / Apps / Admin
        │
        ▼
   NestJS /api/v1
        │
        ▼
      Neon
```

## Inventaire des 4 API Next.js

### POST `/api/waitlist`

| | |
| --- | --- |
| Table | `waitlist_subscribers` |
| Validation | email, honeypot `company`, clamp prénom |
| Rate limit | mémoire IP, ~10/min |
| Dépendances | `@neondatabase/serverless`, `getSql` |
| Données | first_name, email, email_normalized, source |
| PII | oui (email, prénom) |

### POST `/api/contact`

| | |
| --- | --- |
| Table | `contact_messages` |
| Validation | name≥2, email, subject whitelist, message≥10, honeypot |
| Rate limit | ~8/min |
| Dépendances | Neon + `contactConfig.subjects` |
| Données | name, email, subject, message, source |
| PII | oui |

### POST `/api/partnership`

| | |
| --- | --- |
| Table | `partnership_requests` |
| Validation | identité, email, phone optionnel, org, type collab, message≥20 |
| Rate limit | ~8/min |
| Dépendances | Neon |
| Données | first/last name, email, phone, organization, role_title, collaboration_type, message, source |
| PII | oui |

### POST `/api/prelaunch-missions`

| | |
| --- | --- |
| Table | `prelaunch_mission_requests` |
| Validation | identité, phone, email, customer_type, service, description≥20, zone |
| Rate limit | ~8/min |
| Dépendances | Neon |
| Données | contact + type client + service + description + zone + desired_date + source |
| PII | oui |

Runtime commun : `nodejs`. Honeypot `company` sur les 4.

## Principe de migration future

1. Reproduire les endpoints dans NestJS (`/api/v1/...`) + tests
2. Pointer le frontend vers NestJS (feature flag / env)
3. Observer (erreurs, volumes)
4. Retirer les routes Next.js
5. Transférer ownership Prisma Migrate si besoin

## Backend 01

Aucune migration de formulaire. Site public **non modifié** pour cet objectif.
