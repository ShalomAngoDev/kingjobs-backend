# CORRECTIF BO03 — Validation obligatoire / facultatif + seed démo

**Statut :** livré. **Aucune migration / seed Neon production exécutée.**

## 1. Règle finale mandatory / optional

- Valider un dossier ≠ « tous les documents présents sont APPROVED ».
- Seuls les **documents obligatoires** bloquent `APPROVE`.
- Documents **facultatifs** (CV, diplôme, etc. hors `ServiceRequirement`) peuvent rester `PENDING`.

## 2. ServiceRequirement

- Aucune liste hardcodée de docs pro obligatoires.
- Pour un Jobber : `ServiceRequirement` `type=DOCUMENT` + `isRequired` + `isActive` sur les services du profil → documentType obligatoire.
- Métadonnée UI : `requirement.mandatory` + `requiredForService` (« Exigé pour Plomberie »).

## 3. Comportement APPROVE

| Kind | Préconditions Backend |
| --- | --- |
| IDENTITY | CIP/Passeport + résidence + selfie **APPROVED** ; guardian OK |
| JOBBER_PROFILE | Identité `VERIFIED` ; bio ; ≥1 service ; requirements DOCUMENT **APPROVED** ; guardian OK |

## 4. Corrections Backend

- `IdentityCompletionService.checkApproved()` pour APPROVE identité.
- Suppression de l’auto-APPROVE des `UserDocument` au moment du `APPROVE` case.
- `assertJobberCaseReadyForApproval` (bio, services, requirements).
- Enrichissement détail : `requirement`, `documentsReviewSummary`, skills/services Jobber.

## 5. Documents facultatifs

Après APPROVE Jobber : CV / diplôme `PENDING` **restent** `PENDING`.

## 6–9. Seed démo

| | Client | Jobber |
| --- | --- | --- |
| Identité | Aïcha HOUNKPATIN | Junior ADJOVI |
| Email | `aicha.client.demo@kingjobs.test` | `junior.jobber.demo@kingjobs.test` |
| Case | IDENTITY PENDING | JOBBER_PROFILE PENDING (+ IDENTITY APPROVED historique) |
| Docs | CIP/résidence APPROVED, selfie PENDING | Identité APPROVED ; CV/DIPLOMA PENDING facultatifs |
| Profil | ClientProfile | Plomberie (slug catalogue), qualités/compétences, formation, expérience |

Fichiers : JPEG/PDF locaux marqués **DOCUMENT DE DÉMONSTRATION**.

## 10–12. Rendu attendu

- Liste : Aïcha (Client, Cotonou) + Junior (Jobber, Abomey-Calavi), statut À vérifier.
- Détail Aïcha : selfie À vérifier → APPROVE dossier **refusé** tant que selfie non APPROVED.
- Détail Junior : badges Facultatif sur CV/Diplôme → APPROVE **autorisé** si aucun requirement DOCUMENT.

## 13. Commande

```bash
cd Backend
# Prérequis : migrations BO03 déjà appliquées sur la DB *development* (pas Neon prod)
npm run db:seed                 # catalogue (DocumentTypes + Plomberie) si besoin
npm run db:seed:demo:verifications
```

Si le seed échoue avec `address_line does not exist`, la branche DB n'a pas encore les migrations BO03.

## 14. Garde production

`assertActionAllowed('seed-demo')` via `scripts/db-guard.ts` mode `seed-demo-verifications`.  
Refus si `DATABASE_ENV=production` ou DB classée production / unknown.
Couvert par tests unitaires (`db-safety.spec`, `seed-demo-verifications.spec`).

## 15. Idempotence

Upsert par `emailNormalized` démo déterministes ; relancer ≠ dupliquer 10 dossiers.

## 16–17. Tests

- Backend verifications : 34 tests (scénarios A–E inclus).
- Seed safeguards : 3 tests.
- db-safety : seed-demo refusé en production.
- WebSite verifications-admin : 32 tests.

## 18. Confirmation

- Aucune migration Neon **production** exécutée dans ce correctif.
- Aucun seed démo exécuté sur production.
- Tentative de seed sur la branche `.env` development : bloquée tant que les migrations BO03 ne sont pas appliquées sur cette branche (colonne `address_line` absente). Le code seed est prêt.