# Missions - cycle de vie (Backend 04 + BO04 revue + BO05 multi-Jobber)

Module Nest : `src/modules/missions/`. Migrations : `20261002100000_missions_domain`, `20261002160000_bo04_mission_review_v2`, `20261002180000_bo05_mission_assignments`.

**BO04 (revue KingJOBS)** : voir `MISSION-REVIEW.md`. Le Client ne publie plus directement : `submit-for-payment` → paiement interne → `PENDING_REVIEW` → Admin → `PUBLISHED`.

**BO05 (multi-Jobber)** : voir `MULTI-JOBBER-MISSIONS.md`, `MISSION-APPLICATIONS.md`, `MISSION-ASSIGNMENTS.md`. Le paiement publication est confirmé **avant** `PUBLISHED` ; la sélection d'effectif ne repasse pas par `PAYMENT_REQUIRED` lorsque `paymentConfirmedAt` est posé.

## Principes

- **Montants** : `clientPriceAmount` = entier FCFA (XOF), jamais de Float. `currency` est forcée à `XOF`.
- **Aucune donnée sensible ne vient du DTO** : `status`, `clientUserId`, `selectedJobberUserId`, `currency`, snapshots, `minimumAge` sont posés côté serveur. `ValidationPipe(forbidNonWhitelisted)` rejette (400) tout champ inconnu, donc un `PATCH { status }` échoue.
- **Le statut n'est jamais modifiable par PATCH** : seules les méthodes de `MissionLifecycleService` appliquent une transition.
- **Non-propriétaire = 404** (pas de fuite d'existence) pour brouillons et missions d'autrui.

## Référence

`KJ-YYYY-NNNNNN` via `SELECT nextval('mission_reference_seq')` (jamais `count()+1`). La séquence est créée par la migration ; si elle manque (migration non jouée), `MissionsService.generateReference` la crée une fois (`CREATE SEQUENCE IF NOT EXISTS`) puis rejoue la lecture.

## Snapshots & âge minimum

- À la création, et rafraîchis à la publication si le service est toujours actif : `serviceName/Slug`, `categoryName/Slug`.
- `minimumAge = max(service.minimumAge, 18 si un riskFlag ∈ RISK_FLAGS_REQUIRE_ADULT)` (`DRIVING`, `ROAD_INTERVENTION`, `WORK_AT_HEIGHT`, `LIVE_ELECTRICAL_WORK`, `HEAVY_MACHINERY`, `HAZARDOUS_EQUIPMENT`, `NIGHT_SECURITY`). `OTHER_RESTRICTED_ACTIVITY` seul n'impose pas 18.
- Services passés à 18 ans (règle produit V1, pas une conclusion juridique) : `chauffeur`, `agent-securite`, `gardien`, `massage`, `depannage-automobile` (`CATALOG_ADULT_ONLY_SLUGS`, testé contre `CATALOG_SERVICE_SEEDS`).

## Machine à états

```
DRAFT ──► PUBLISHED ──► APPLICATION_SELECTED ──► PAYMENT_REQUIRED ──► CONFIRMED ──► READY_TO_START ──► IN_PROGRESS ──► COMPLETION_PENDING ──► COMPLETED
  │           │                  │                      │                 │ └──────────────────────────┘ (démarrage direct possible)
  └───────────┴──────────────────┴──────────────────────┴─────────────────┴──► CANCELLED
                                 └──── DISPUTED ◄── (APPLICATION_SELECTED … COMPLETION_PENDING)
```

Table complète : `MISSION_TRANSITIONS` (`mission-lifecycle.service.ts`). `COMPLETED` et `CANCELLED` sont terminaux. `DISPUTED → CANCELLED | COMPLETED` est réservé à la résolution admin (Backend 05) : aucun endpoint aujourd'hui.

Chaque transition :
1. vérifie la transition autorisée (`409` sinon) ;
2. utilise un verrou optimiste `updateMany({ where: { id, status: ancienStatut } })` (`count !== 1` → `409`) ;
3. écrit une ligne `MissionStatusHistory` (`fromStatus`, `toStatus`, `actorUserId`, `reason`, `metadata.actorType`). La création écrit `null → DRAFT`.

| Méthode | Transition | Acteur |
| --- | --- | --- |
| `publish` | DRAFT → PUBLISHED | Client propriétaire |
| `selectApplication` | Select progressif ; dernière place : PUBLISHED → APPLICATION_SELECTED → CONFIRMED (si payé) | Client propriétaire |
| `markPaymentConfirmed` | PAYMENT_REQUIRED → CONFIRMED | **Interne uniquement** (Backend 05 / tests) |
| `markReadyToStart` | CONFIRMED → READY_TO_START | Interne |
| `startMission` | CONFIRMED \| READY_TO_START → IN_PROGRESS | Via validation code/QR |
| `requestCompletion` | IN_PROGRESS → COMPLETION_PENDING | Jobber sélectionné |
| `completeMission` | COMPLETION_PENDING → COMPLETED | Via validation code/QR |
| `cancel` | → CANCELLED | Client (DRAFT…READY_TO_START) ou Jobber sélectionné (APPLICATION_SELECTED…READY_TO_START) |
| `dispute` | → DISPUTED | Incident bloquant / SAFETY |

### Protection du paiement

**Il n'existe aucune route HTTP pour confirmer un paiement.** `MissionsService.markPaymentConfirmed(missionId, actorUserId?)` est exposée uniquement en méthode de service (module exporte `MissionsService`). `missions.routes.spec.ts` et l'e2e vérifient l'absence de toute route `payment|confirm` (404). FedaPay n'est pas implémenté (Backend 05).

## Sélection multi-Jobber (transactionnelle, BO05)

`POST /missions/:missionId/applications/:applicationId/select` :

1. Réévaluation de l'éligibilité du Jobber (hors transaction, `409` si plus éligible).
2. `prisma.$transaction` :
   - `SELECT … FOR UPDATE` sur la Mission ;
   - garde places restantes (`computeStaffing` / affectations ACTIVE) ;
   - candidature `PENDING → SELECTED` + création `MissionAssignment` ACTIVE ;
   - si places restantes : Mission reste `PUBLISHED` ;
   - si effectif complet : autres `PENDING → MISSION_FILLED`, puis `PUBLISHED → APPLICATION_SELECTED → CONFIRMED` lorsque `paymentConfirmedAt` (ou `publishedAt`) est déjà posé ;
   - **pas** de transition vers `PAYMENT_REQUIRED` après sélection dans le flux BO04+ (paiement avant publication).

Annulation d'un slot : `POST /missions/:missionId/assignments/:assignmentId/cancel` (rouvre une place ; peut repasser en `PUBLISHED`).

Détails : `MULTI-JOBBER-MISSIONS.md`.

## Éligibilité à la candidature

`MissionApplicationsService.assertJobberEligible` :
profil Jobber requis → `JobberService` pour le `serviceId` de la mission (non `SUSPENDED`) → `JobberEligibilityService.evaluate({ user, jobber, service, requirements })` (exigences non vérifiables = non éligible) → `calculateAge >= mission.minimumAge`.
Un Jobber peut se retirer (`PENDING → WITHDRAWN`) puis re-postuler (la ligne est réactivée, contrainte unique `missionId+jobberUserId`). Un Jobber `SELECTED` doit annuler la mission, pas retirer sa candidature.

## Confidentialité de l'adresse

| Lecteur | `addressLine`, `latitude`, `longitude` |
| --- | --- |
| Client propriétaire | toujours |
| Jobber sélectionné | à partir de `APPLICATION_SELECTED` (masqué si `CANCELLED`) |
| Autres Jobbers (`/available`, détail PUBLISHED) | **jamais** (`city`, `district` seulement) |
| Admin | toujours |

La liste des candidatures n'expose que `firstName`, `lastName`, `headline`, `bio` (+ `userId`) : jamais email, téléphone, date de naissance ni hash.

## Vérifications code / QR

| Étape | Génération (Client propriétaire) | Validation (Jobber sélectionné) |
| --- | --- | --- |
| Début | `POST …/verifications/start-code` → `{ code }` ou `start-qr` → `{ token }` ; mission `CONFIRMED` ou `READY_TO_START` | `POST …/verifications/validate-start { code }` ou `{ token }` → `IN_PROGRESS` |
| Fin | `end-code` / `end-qr` ; mission `COMPLETION_PENDING` | `validate-end` → `COMPLETED` |

Le Client remet le secret au Jobber (de vive voix ou par QR), qui le saisit : la présence/validation est donc conditionnée par le Client.

- Code : 4 chiffres (`generateFourDigitCode`) ; QR : jeton opaque (`generateOpaqueToken`).
- **Le secret n'est retourné qu'une fois et jamais stocké en clair** : `secretHash = sha256Hex("<missionId>:<type>:<secret>")`.
- TTL : 24 h (`VERIFICATION_TTL_HOURS`). Un nouveau secret du même type invalide les précédents.
- `maxAttempts` = 5 : chaque échec incrémente `attempts` (persisté hors transaction) ; à 5, la route répond `429` même avec le bon code → régénérer. Les routes de validation sont aussi limitées par `@Throttle` (10/min).
- Usage unique : claim `updateMany({ usedAt: null })` dans la transaction qui change aussi le statut ; les autres secrets non utilisés de la phase (code **et** QR) sont expirés.
- Un secret d'une autre mission ou d'une autre phase n'est jamais accepté.

## Annulations

`POST /missions/:id/cancel { reasonCode, reasonText? }` crée une `MissionCancellation` (acteur, `previousStatus`) et rejette les candidatures `PENDING`. Une mission `IN_PROGRESS` ou au-delà ne s'annule pas : passer par un incident/litige. Les règles de remboursement/pénalité sont hors périmètre (Backend 05).

## Incidents

`POST /missions/:id/incidents { type, description, blocksMission? }` (Client propriétaire ou Jobber sélectionné, mission `APPLICATION_SELECTED` ou plus loin, hors `CANCELLED`) :

- `JOBBER_NO_SHOW` : signalé par le Client ; `CLIENT_NO_SHOW` : par le Jobber. Seulement sur mission `CONFIRMED`/`READY_TO_START` dont l'heure prévue est passée. Incident `OPEN`, **sans** blocage par défaut.
- `blocksMission === true` **ou** type `SAFETY` ⇒ mission `DISPUTED` (si la transition existe ; une mission `COMPLETED` conserve l'incident sans changer de statut).
- Admin : `PATCH /admin/incidents/:id/status` — `OPEN → UNDER_REVIEW → RESOLVED → CLOSED` (`resolvedAt` posé à `RESOLVED`/`CLOSED`).

## Routes (`/api/v1`, JWT partout, aucune route `@Public`)

### Client

| Méthode | Route |
| --- | --- |
| POST | `/missions` — crée un DRAFT (+ `ClientProfile` à la demande) |
| PATCH | `/missions/:id` — DRAFT : tous les champs métier ; PUBLISHED : `title`, `description`, `district`, `addressLine`, `latitude`, `longitude` |
| POST | `/missions/:id/publish` |
| GET | `/missions/me/client` |
| GET | `/missions/:id` — vue selon le rôle (`viewerRole`) |
| GET | `/missions/:id/applications` |
| POST | `/missions/:missionId/applications/:applicationId/select` |
| POST | `/missions/:id/cancel` |
| POST | `/missions/:id/verifications/start-code`, `start-qr`, `end-code`, `end-qr` |
| POST | `/missions/:id/incidents` |

### Jobber

| Méthode | Route |
| --- | --- |
| GET | `/missions/available` — services `ELIGIBLE` du profil, âge suffisant, sans adresse ; filtres `serviceId`, `city`, `page`, `limit` |
| GET | `/missions/me/jobber` — missions où je suis sélectionné |
| POST | `/missions/:id/applications` |
| POST | `/missions/:missionId/applications/:applicationId/withdraw` |
| POST | `/missions/:id/verifications/validate-start`, `validate-end` |
| POST | `/missions/:id/request-completion` |
| POST | `/missions/:id/cancel` (après sélection) |
| POST | `/missions/:id/incidents` |

### Admin (`ADMIN`, `SUPER_ADMIN`)

`GET /admin/missions`, `GET /admin/missions/:id`, `GET /admin/missions/:id/history`, `GET /admin/incidents`, `PATCH /admin/incidents/:id/status`.

> Ordre de déclaration : `JobberMissionsController` (routes statiques `available`, `me/jobber`) est enregistré **avant** `MissionsController` (`GET :id`). Testé dans `missions.routes.spec.ts`.

## Tests

- Unitaires (`src/modules/missions/*.spec.ts`) : cycle de vie, candidatures, vérifications, incidents, service principal, règles pures, surface HTTP — adossés à un faux Prisma en mémoire (`test/support/in-memory-prisma.ts`, transactions sérialisées + rollback).
- E2E HTTP (`test/missions.e2e-spec.ts`, `MissionsE2eModule`) : create → publish → apply → select ⇒ `PAYMENT_REQUIRED`, absence de route de paiement (404), cycle complet jusqu'à `COMPLETED`, champs forgés rejetés, rôles admin. Le test de santé (`app.e2e-spec.ts`) reste indépendant.

## Hors périmètre / suite (Backend 05+)

FedaPay et webhooks de paiement (appelleront `markPaymentConfirmed`), remboursements/pénalités, résolution admin des litiges (`DISPUTED → …`), notifications, avis, matching géographique.
