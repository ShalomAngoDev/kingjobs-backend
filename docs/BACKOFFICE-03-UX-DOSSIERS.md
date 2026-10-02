# CORRECTIF BO03 - UX Vérifications (dossiers)

**Statut :** correctif UX livré. **Aucune migration production.** SQL BO03 inchangé.

## Compteurs Dashboard (avant / après)

| KPI | Avant | Après |
| --- | --- | --- |
| Principal | Risque de lecture « Documents à vérifier » au même niveau que les dossiers (`documentsPending` exposé / badge Documents) | **Dossiers à vérifier** = `totalPending` (`identityPending` + `jobberProfilePending`) |
| Secondaire | - | **À compléter** = `needsChanges` (cas `NEEDS_CHANGES`) |
| Secondaire | - | **Validés récemment** = `recentlyApproved` (7 jours, alias client `approvedRecently`) |
| Technique | `documentsPending` comptait les `UserDocument` PENDING / UNDER_REVIEW | Conservé côté API uniquement ; **pas** de KPI Dashboard ni d’entrée nav principale |

Exemple scénario Koffi (tests) :

- 1 `VerificationCase` `JOBBER_PROFILE` + 5 `UserDocument`
- Dashboard : **1** dossier à vérifier
- **pas** 5 dossiers

## Navigation

```
VÉRIFICATIONS
→ Dossiers à vérifier   (/admin/verifications)
```

- Pas d’entrée principale **Documents** dans la sidebar Vérifications.
- Badge menu = `totalPending` (dossiers), pas le volume de documents.
- Les documents restent accessibles depuis le détail du dossier (et routes `/admin/documents/:id` pour revue / proxy contenu).

## Liste `/admin/verifications`

Une ligne = un dossier (`VerificationCase`) / une personne.

Colonnes typiques : Utilisateur, Profil, Pays / Ville, Documents (`X/Y reçus`), Soumis le, Statut.

`documentsSummary` = complétude du dossier, pas une file de travail indépendante.

## Détail `/admin/verifications/[id]`

1. **Identité** (prénom, nom, DOB, adresse, pays, email, téléphone, langues)
2. **Documents d’identité** (CIP / Passeport, certificat de résidence, selfie live)
3. Si Jobber : **Profil professionnel** puis **Documents professionnels**
4. Décision globale : Valider / Demander des modifications / Refuser

Statuts document individuels : `PENDING` | `APPROVED` | `NEEDS_CHANGES` | `REJECTED`.  
Décision finale portée par le dossier.

## Relation VerificationCase / UserDocument

Modèle inchangé (conservé) :

- `UserDocument.userId` → `User` (obligatoire)
- `UserDocument.verificationCaseId` → `VerificationCase` (nullable, rattaché à la soumission)

Soumission identité : rattache les pièces d’identité au cas `IDENTITY`.  
Soumission Jobber : rattache les pièces **non identité** au cas `JOBBER_PROFILE`.

Identité commune sur `User` : un Client + Jobber ne dépose pas deux fois CIP / résidence / selfie. Une identité `VERIFIED` est prérequis Jobber.

## Comportement Client / Jobber

| Capacité | Contenu du dossier | Effet si validé |
| --- | --- | --- |
| Client | Infos perso + CIP/Passeport + résidence + selfie | Identité vérifiée ; publication Mission selon autres règles |
| Jobber | **Un seul envoi** : identité + profil pro + services / docs | Identité `VERIFIED` + Jobber `ACTIVE` (décision unique sur le dossier Jobber) |

Soumission Jobber : ouvre le dossier identité (si besoin) **et** le dossier Jobber en même temps.  
Validation dossier Jobber : si l’identité est encore `PENDING`, elle est aussi passée en `VERIFIED` (pièces d’identité obligatoires déjà approuvées).  
Validation dossier identité seule : réservée au parcours Client (ou identité sans Jobber).

Les ServiceRequirements DOCUMENT affectent l’éligibilité **par service**, pas la validation globale du profil.

## Tests

- Backend `verifications.service.spec.ts` :
  - identité : 1 cas + 3 docs → `totalPending === 1`
  - **Koffi** : 1 `JOBBER_PROFILE` + 5 docs → `totalPending === 1`, liste 1 ligne, 5 pièces rattachées
- WebSite `verifications-admin.test.ts` :
  - nav sans entrée Documents isolée, label « Dossiers à vérifier »
  - `formatDocumentsSummary` → `5/5 reçus`
  - compteurs : `totalPending` = somme des cas ; `documentsPending` non traité comme KPI principal

## Hors scope

- Pas de suppression de `UserDocument` / `UserDocumentEvent`
- Pas de modification SQL BO03
- Pas de migrate Neon
