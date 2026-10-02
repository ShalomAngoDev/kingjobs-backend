# Exigences documentaires configurables par Service

**Statut :** livré. **Aucune migration schema.** **Aucune action Neon production.**

## 1–2. Modèles actuels (inchangés)

- `DocumentType` : `id`, `code` unique, `name`, `description`, `isActive`
- `ServiceRequirement` : `serviceId`, `type` (DOCUMENT…), `code`, `label`, `isRequired`, `isActive`, `documentTypeId?`

Pas de `ServiceDocumentRequirement`. Pas d’exigence au niveau Category (V1).

## 3. Modifications réalisées

| Zone | Changement |
| --- | --- |
| Éligibilité | `DOCUMENT` satisfait si `UserDocument` **APPROVED** pour le `documentTypeId` |
| Profil Jobber APPROVE | **ne bloque plus** sur ServiceRequirements (éligibilité = par JobberService) |
| Admin catalogue | `POST/PATCH /admin/document-types`, liste searchable `professionalOnly` |
| UX | Modal exigence : sélection / création type sans code technique |
| API Jobber | `GET /jobbers/me/document-requirements` (synthèse dédupliquée) |
| Sync | Recalcul `JobberService.status` après revue document |

## 4–8. UX fiche Service

`/admin/catalogue/services/[id]` → Exigences → **Ajouter une exigence**

- Recherche DocumentType (hors identité CIP/selfie…)
- Ou **Créer un nouveau type** (nom seul → code généré, dédoublonnage)
- Affichage : Document / Obligatoire / Statut / Désactiver|Réactiver

## 9–11. API

**Admin :** document-types CRUD soft + `POST services/:id/requirements`  
**Public catalogue :** `GET /services/:slug` inclut déjà `requirements`  
**Jobber :** `GET /jobbers/me/document-requirements` + eligibility enrichie

## 12–16. Règles métier

- Facultatif (CV…) : hors ServiceRequirement → n’empêche ni profil ni service
- Obligatoire DOCUMENT : bloque **éligibilité du service** / candidature mission
- Deux services même DocumentType → 1 upload
- Identité globale hors configuration Service

## 17. Audit

Events WebSite : `CREATE_DOCUMENT_TYPE`, `ADD/DISABLE/REACTIVATE_SERVICE_REQUIREMENT` via metadata (pas de nouvelle valeur enum Prisma → **pas de migration**).

## 18. Seed demo

Junior / Plomberie inchangé (pas de requirement inventé). CV/Diplôme PENDING restent facultatifs.

## 19. Tests

- `document-type.util.spec`
- `jobber-eligibility` DOCUMENT missing / APPROVED
- Verifications : profil Jobber APPROVE malgré requirement service PENDING
- JobbersService mock sync

## 20. DB / migration

**Aucune.** Schema BO02 déjà suffisant.

## 21. Confirmation

Aucune migrate / seed production exécutée.
