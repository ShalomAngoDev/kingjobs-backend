# BACK-OFFICE 03.1 — Rapport GO / NO-GO (production readiness)

**Date :** 2026-10-02  
**Neon production :** **NON migré** (aucun `migrate deploy` exécuté dans ce sprint).

---

## Verdict

### NO-GO

Corrections / actions manuelles requises avant déploiement contrôlé.

---

## 1. Provider storage / abstraction

- Abstraction : `FileStorageService`
- Providers : `local_private` | `object_storage` (S3-compatible générique) | `memory` (tests)
- Doc : `Backend/docs/KYC-PRIVATE-STORAGE.md`

## 2. Configuration

Variables (voir `.env.example`) : `STORAGE_PROVIDER`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `STORAGE_SIGNED_URL_TTL_SECONDS` (180), `STORAGE_MAX_UPLOAD_BYTES` (8 Mo).

## 3. Sécurité bucket

Bucket privé attendu. Pas d’ACL `public-read`. Pas d’URL permanente publique.

## 4. Upload

Auth + ownership (userId = JWT). Contrôle DocumentType, MIME, magic bytes, taille. Pas d’upload pour un autre user.

## 5. MIME

Allowlist : `image/jpeg`, `image/png`, `image/webp`, `application/pdf`. Magic bytes validés. SVG/HTML/EXE rejetés (hors allowlist + magic).

## 6. Tailles

Défaut **8 Mo** (`STORAGE_MAX_UPLOAD_BYTES`), configurable jusqu’à 20 Mo côté validation env.

## 7. Storage keys

`verification/{sha256(userId)[0:16]}/{uuid}` — sans PII. Filename original sanitizé en metadata uniquement.

## 8. Signed URL / streaming

V1 : **streaming** Backend (`Cache-Control: private, no-store`).  
`getSignedUrl` disponible sur `object_storage` (TTL ≤ 15 min, non persisté).

## 9. Autorisations

Propriétaire ou ADMIN/SUPER_ADMIN. Autres → 404. UUID seul insuffisant.

## 10. Audit consultation

`AdminAuditAction.VIEW_VERIFICATION_DOCUMENT` (migration `20261002150000_bo03_1_storage_and_country`) pour CIP / PASSPORT / IDENTITY_DOCUMENT / résidence / selfie. Pas de contenu dans l’audit.

## 11. Suppression

`delete(key)` implémenté (local + S3 + memory). **Pas** de purge auto prod (rétention à finaliser).

## 12. Remplacement

Nouvelle clé objet ; ancien document `EXPIRED`. Pas d’écrasement silencieux.

## 13. Failure handling

Put storage puis DB ; si DB échoue → compensation `delete`. Objet absent → `404` métier (pas d’XML S3).

## 14. Production + local_private

Fail-fast au boot : `NODE_ENV=production` + `local_private` → `StorageConfigurationError`.

## 15. Tests storage

InMemory + LocalPrivate + clés/sanitize. Suites verifications + missions gates : **151 tests** ciblés OK.

## 16. SQL BO03 relu

Fichier : `20261002140000_identity_verification_bo03/migration.sql`  
Additif : enums ADD VALUE / CREATE TYPE, tables KYC, FKs CASCADE/SET NULL, indexes.  
**Pas de DROP.**

## 17. CREATE TABLE IF NOT EXISTS

Présent pour idempotence locale / rejeu. **Risque** : masque un drift si une table existe avec un schéma différent.  
Recommandation avant prod : appliquer sur Neon **une seule fois** via `migrate deploy` après baseline, et comparer schéma attendu (pas de shadow prod).

## 18. Drift production (READ-ONLY)

Contrôle `_prisma_migrations` Neon :

| Attendu (repo) | Sur Neon |
| --- | --- |
| `20261001140000_auth_identity` | **absent** |
| `20261001160000_service_catalog_jobber_eligibility` | **absent** |
| `20261002100000_missions_domain` | **présent** |
| `20261002120000_multi_worker_missions_and_operations_catalog` | **absent** |
| `20261002140000_identity_verification_bo03` | **absent** |
| `20261002150000_bo03_1_storage_and_country` | **absent** |

Tables métier (users, missions, services…) **existent**, mais l’historique Prisma est **incomplet**.  
Tables BO03 (`verification_cases`, `user_documents`, …) : **absentes**.  
Enums `IdentityVerificationStatus` / `JobberStatus` : **sans** `NEEDS_CHANGES`.

→ **STOP.** Ne pas `migrate deploy` BO03 tant que le baseline / `migrate resolve` des migrations antérieures n’est pas corrigé manuellement.

## 19. Enums

`NEEDS_CHANGES` ajouté côté code + migration BO03. Gates publish/apply couvrent déjà ces statuts (tests OK).

## 20. country_code

Décision 03.1 (interim) : conserver `DEFAULT 'BJ'` + NOT NULL pour compatibilité
et pour ne pas déclencher un `ALTER … DROP` bloqué par `db-guard`.

Sémantique produit : **pays de résidence / adresse**, **pas** la nationalité.

Follow-up recommandé (après baseline Neon) : rendre `country_code` nullable
sans DEFAULT, pour ne pas déclarer « béninois » une personne qui n’a pas renseigné
son pays.

## 21. DocumentTypes

Seed additif : CIP, PASSPORT, RESIDENCE_CERTIFICATE, LIVE_SELFIE, CV, DIPLOMA, **CERTIFICATE** + **CERTIFICATION**, etc. Idempotent.

## 22. IDENTITY_DOCUMENT

Legacy : conservé en seed / lectures historiques. **Nouvelles soumissions refusées** → CIP ou PASSPORT.

## 23. Client gate

DRAFT sans KYC OK. Publish exige identité `VERIFIED` + compte actif + guardian OK (tests lifecycle OK).

## 24. Jobber gate

Apply exige identité `VERIFIED` + `JobberStatus.ACTIVE` + eligibility (tests applications OK).

## 25. Emails

Décision DB d’abord ; échec Resend non bloquant (log warn).

## 26. Tests totaux (ciblés)

151 passed (storage + verifications + publish/apply gates).

## 27. Build / typecheck

Prisma generate OK. Typecheck à valider en CI ; jest ciblé vert.

## 28. GO / NO-GO

**NO-GO** parce que :

1. Historique Prisma Neon incomplet (drift baseline) ;
2. Storage `object_storage` non encore provisionné / env Render non renseignées ;
3. Migrations BO03 + 03.1 non applicables tant que (1) n’est pas résolu ;
4. Politique de rétention / purge fichiers non finalisée (acceptable pour V1 si documenté, mais snapshot + storage prod requis).

## 29. Plan de déploiement (quand GO)

1. Snapshot / branche Neon  
2. `prisma migrate resolve --applied <migrations manquantes déjà en schéma>` (revue humaine)  
3. Provisionner bucket S3-compatible **privé**  
4. Env Render : `STORAGE_PROVIDER=object_storage` + `S3_*`  
5. Deploy Backend (code compatible)  
6. `DATABASE_ENV=production` → `npm run db:prod:deploy` (BO03 puis 03.1)  
7. `npm run db:seed` (DocumentTypes)  
8. Healthcheck  
9. Smoke identity (docs **fictifs** uniquement)  
10. Smoke Admin review  
11. Smoke Client publish gate  
12. Smoke Jobber apply gate  
13. Emails + audit VIEW  
14. Surveiller logs (sans PII / sans URL signée)

Rollback logique : revert deploy app ; ne pas DROP tables KYC ; désactiver uploads si besoin.

## 30. Actions manuelles requises

- [ ] Réconcilier `_prisma_migrations` Neon (resolve) sans shadow prod  
- [ ] Créer bucket KYC privé + credentials  
- [ ] Renseigner env Render object_storage  
- [ ] Snapshot Neon  
- [ ] Revue humaine SQL BO03 + 03.1  
- [ ] Puis seulement `migrate deploy`

---

**BACK-OFFICE 03.1 TERMINÉ - NO-GO, CORRECTIONS REQUISES**
