# BACK-OFFICE 03 - Rapport revue migration (§92)

**Statut :** développement terminé, **migration NON appliquée sur Neon production**.

**Migration locale :** `Backend/prisma/migrations/20261002140000_identity_verification_bo03/migration.sql`

## Périmètre SQL (additif uniquement)

### Enums

- `IdentityVerificationStatus` += `NEEDS_CHANGES`
- `JobberStatus` += `NEEDS_CHANGES`
- Nouveaux : `UserDocumentStatus`, `VerificationCaseKind`, `VerificationCaseStatus`, `JobberSkillKind`, `IdentityDocumentSubType`, `AdminAuditAction`

### Colonnes User

- `address_line`, `city`, `country_code` (défaut `BJ`), `administrative_area`
- Index `identity_verification_status`, `(country_code, city)`

### Colonnes JobberSkill

- `kind` (`JobberSkillKind`, défaut `SKILL`)

### Tables nouvelles

| Table | Rôle |
| --- | --- |
| `user_languages` | Langues multi-lignes |
| `jobber_educations` | Formations optionnelles |
| `jobber_experiences` | Expériences optionnelles |
| `verification_cases` | Dossiers IDENTITY / JOBBER_PROFILE |
| `user_documents` | Pièces KYC (storage key opaque) |
| `user_document_events` | Historique pièce |
| `admin_audit_events` | Audit Admin persistant |

### Seed DocumentType (additif, hors SQL migration)

Codes : `CIP`, `PASSPORT`, `RESIDENCE_CERTIFICATE`, `LIVE_SELFIE`, `CV` (conserver `IDENTITY_DOCUMENT` et existants).

## Environnements

| Env | Action |
| --- | --- |
| Docker local | `prisma migrate deploy` autorisé (déjà utilisé pour le sprint) |
| Neon production | **Interdit dans ce sprint**. Revue humaine requise avant `migrate deploy` |
| Storage prod | Provider cloud à brancher (V1 = `local_private` Docker uniquement) |

## Checklist revue avant prod

1. Relire le SQL complet de la migration (ADD VALUE enums + CREATE TABLE IF NOT EXISTS).
2. Backup / snapshot Neon.
3. Appliquer en fenêtre contrôlée (`prisma migrate deploy` sur l’URL prod uniquement après validation).
4. Seed DocumentType additifs.
5. Vérifier variables : storage path / TTL selfie / Resend.
6. Smoke : submit identité → approve → publish mission ; submit Jobber → approve → apply.

## Livrables code

- Backend : module `verifications/`, `storage/`, gates publish/apply, emails décision, docs `IDENTITY-VERIFICATION.md` + `PROFILE-VERIFICATION.md`
- WebSite : `/admin/verifications`, documents, nav, dashboard, RBAC `verifications.*`, `BACKOFFICE-03-VERIFICATIONS.md`
- Tests : state machine, service (submit / approve / guardian / USER 403 / pas de notes internes), gates opérationnels

---

**BACK-OFFICE 03 DÉVELOPPEMENT TERMINÉ - VÉRIFICATIONS & VALIDATION DES PROFILS PRÊTES POUR REVUE MIGRATION**
