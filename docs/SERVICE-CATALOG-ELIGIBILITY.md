# Service Catalog & Jobber Eligibility (Backend 03)

## Objectif

Source de vérité du catalogue KingJOBS (8 catégories / 40 services) et couche métier Jobber :

- services proposés ;
- compétences ;
- zones d’intervention ;
- exigences configurables ;
- moteur d’éligibilité ;
- complétion de profil.

**Hors scope** : missions, matching, paiement, upload documents, KYC opérationnel, GPS temps réel.

---

## Modèles Prisma

| Modèle | Rôle |
| --- | --- |
| `ServiceCategory` | Catégories catalogue (`slug` unique, `isActive`, `displayOrder`) |
| `Service` | Services (`slug` unique, `minimumAge`, `categoryId`) |
| `DocumentType` | Catalogue de types documentaires (pas de fichiers) |
| `ServiceRequirement` | Exigences par service (types enum) |
| `JobberService` | N↔N Jobber ↔ Service + statut d’éligibilité |
| `JobberSkill` | Compétences déclaratives (`scopeKey` pour unicité) |
| `JobberServiceArea` | Zones d’intervention (texte + GPS optionnel) |

`JobberProfile` enrichi : `headline`, `yearsOfExperience` (bio existant conservé).

### Enums

- `JobberServiceStatus` : `DRAFT`, `PENDING_ELIGIBILITY`, `ELIGIBLE`, `RESTRICTED`, `SUSPENDED`
- `ServiceRequirementType` : `MINIMUM_AGE`, `DOCUMENT`, `QUALIFICATION`, `MANUAL_APPROVAL`, `LEGAL_GUARDIAN_APPROVAL`

### Indexes / uniques clés

- `ServiceCategory.slug`, `Service.slug`, `DocumentType.code` uniques
- `JobberService (jobberProfileId, serviceId)` unique
- `ServiceRequirement (serviceId, code)` unique
- `JobberSkill (jobberProfileId, nameNormalized, scopeKey)` unique

---

## Seed

Fichier : `prisma/seed.ts`  
Données : `src/common/constants/catalog-seed-data.ts`

```bash
npm run prisma:seed
```

Idempotent via `upsert` sur `slug` / `code`.  
Tous les services démarrent avec `minimumAge = 16` (aucune règle juridique inventée).  
Document types seedés sans exigences obligatoires attachées aux services.

---

## Moteur d’éligibilité

`JobberEligibilityService.evaluate(...)` retourne :

```json
{
  "eligible": false,
  "status": "RESTRICTED",
  "reasons": [{ "code": "MINIMUM_AGE_NOT_MET", "message": "..." }]
}
```

Considère :

- `User.status` ;
- `JobberProfile.status` ;
- `Service.isActive` ;
- `Service.minimumAge` vs âge ;
- exigences actives.

### Exigences non encore vérifiables

`DOCUMENT`, `QUALIFICATION`, `MANUAL_APPROVAL` **obligatoires** → `PENDING_REQUIREMENT` (jamais `eligible=true` silencieux).

### Mineurs 16–17

Si exigence `LEGAL_GUARDIAN_APPROVAL` active :

- adulte → ignorée ;
- mineur + `legalGuardianStatus != APPROVED` → non éligible / pending ;
- mineur + `APPROVED` → condition satisfaite.

Le statut `JobberService.status` est **toujours** calculé côté backend (jamais accepté du client).

---

## Profile completion

`JobberProfileCompletionService` — calcul dérivé (non persisté) :

| Code | Critère |
| --- | --- |
| `IDENTITY` | prénom + nom |
| `PHONE_VERIFIED` | téléphone vérifié |
| `JOBBER_ACTIVATED` | profil existe |
| `BIO` | bio ≥ 20 caractères |
| `SERVICE` | ≥ 1 service |
| `SERVICE_AREA` | ≥ 1 zone active |

---

## Endpoints

### Public (`@Public`)

| Méthode | Path |
| --- | --- |
| GET | `/api/v1/service-categories` |
| GET | `/api/v1/service-categories/:slug` |
| GET | `/api/v1/services?category=` |
| GET | `/api/v1/services/:slug` |

Actifs uniquement par défaut.

### Jobber (JWT + profil activé)

| Méthode | Path |
| --- | --- |
| GET/PATCH | `/api/v1/jobbers/me` (Backend 02 + headline / years) |
| GET/POST | `/api/v1/jobbers/me/services` |
| PATCH/DELETE | `/api/v1/jobbers/me/services/:serviceId` |
| GET/POST | `/api/v1/jobbers/me/service-areas` |
| PATCH/DELETE | `/api/v1/jobbers/me/service-areas/:id` |
| GET/POST | `/api/v1/jobbers/me/skills` |
| DELETE | `/api/v1/jobbers/me/skills/:id` |
| GET | `/api/v1/jobbers/me/profile-completion` |
| GET | `/api/v1/jobbers/me/eligibility` |
| GET | `/api/v1/jobbers/me/eligibility/:serviceId` |

### Admin (`ADMIN` \| `SUPER_ADMIN`)

| Méthode | Path |
| --- | --- |
| GET | `/api/v1/admin/catalog/overview` |
| GET | `/api/v1/admin/service-categories` (toutes, filtre `search` optionnel) |
| GET | `/api/v1/admin/service-categories/:id` (UUID) |
| POST/PATCH | `/api/v1/admin/service-categories` / `:id` |
| GET | `/api/v1/admin/services` (paginé : `page`, `pageSize`, `search`, `categoryId`, `status`, `minAge`) |
| GET | `/api/v1/admin/services/:id` (UUID, exigences actives et inactives) |
| POST/PATCH | `/api/v1/admin/services` / `:id` |
| POST | `/api/v1/admin/services/:id/requirements` |
| PATCH | `/api/v1/admin/service-requirements/:id` |
| GET | `/api/v1/admin/document-types` (types actifs) |

Désactivation = `isActive=false` (pas de DROP).

---

## Limites (`CATALOG_LIMITS`)

- max 15 services Jobber ;
- max 40 compétences ;
- max 20 zones ;
- `countryCode` ISO alpha-2 ;
- rayon max 200 km.

---

## Ownership & sécurité

- `userId` / `jobberProfileId` / `status` / éligibilité dérivés du JWT ;
- ownership systématique sur zones / skills / services Jobber ;
- USER ne peut pas modifier le catalogue.

---

## Suppression

| Entité | Stratégie |
| --- | --- |
| Catégorie / Service | soft (`isActive=false`) |
| JobberService | hard delete OK tant qu’aucune Mission (Backend 04 devra snapshotter) |

---

## Préparation Backend 04

Une future `Mission` devra référencer `Service` (et éventuellement snapshot `serviceName`, `serviceSlug`, `categorySlug`, prix/règles) pour que la modification du catalogue ne réécrive pas l’historique.

---

## Migration

`prisma/migrations/20261001160000_service_catalog_jobber_eligibility/`

- Additive uniquement (CREATE ENUM/TABLE/INDEX/FK + ALTER jobber_profiles ADD COLUMN).
- Ne touche **pas** aux tables pré-lancement.

Application :

```bash
npm run prisma:migrate:deploy
npm run prisma:seed
```

Sur Neon production : déployer via Render `preDeployCommand` ou manuellement avec `DIRECT_URL`.  
**Ne jamais** `prisma migrate reset` sur Neon partagé.

---

## Limites actuelles / TODO

- Pas de stockage de documents / preuves d’exigences ;
- Pas de workflow représentant légal opérationnel ;
- Pas de géocodage automatique ;
- Catalogue frontend WebSite encore dupliqué (à brancher sur l’API plus tard) ;
- E2e HTTP catalogue/admin non couverts (unitaires + mocks).
