# Mission — création V2 / BO04.1 (contrat mobile)

## Pricing scope (obligatoire)

| `rateScope` | Sémantique de `rateAmount` |
| --- | --- |
| `PER_JOBBER` | Montant pour **une** personne |
| `TOTAL` | Budget pour **toutes** les personnes (`workersNeeded`) |

Ne jamais supposer silencieusement `PER_JOBBER` côté affichage Admin : toujours exposer le scope.

### Persisté vs calculé

| Champ | Persisté | Notes |
| --- | --- | --- |
| `pricingType` | oui | FIXED / HOURLY / DAILY |
| `rateAmount` | oui | Montant saisi |
| `rateScope` | oui | PER_JOBBER / TOTAL |
| `workersNeeded` | oui | 1–50 (besoin, pas assignment) |
| `estimatedAmount` / `clientPriceAmount` | oui | = **estimatedTotalAmount** |
| `workerGrossAmount` | **non** | Calculé à la lecture |
| commission / net | **non** | Futur Payment (`KINGJOBS_COMMISSION_BPS = 1500`) |

### Exemples

**FIXED PER_JOBBER** — 10 Jobbers × 10 000 → total 100 000 ; brut/Jobber 10 000.

**FIXED TOTAL** — 100 000 pour 10 → brut/Jobber 10 000 ; total 100 000.

**HOURLY TOTAL** — 20 000 / h pour l’ensemble, 10 Jobbers, 4 h → 2 000 / h / Jobber → 8 000 / Jobber → 80 000 total.

### Division FCFA

Montants entiers uniquement. `TOTAL` non divisible par `workersNeeded` → **400** métier :

> Le budget total doit pouvoir être réparti équitablement entre les N Jobbers.

Pas d’arrondi silencieux.

### Commission future (documentaire)

```
workerGross = 10_000
commission  = floor(10_000 × 15 %) = 1_500
workerNet   = 8_500
```

## DTO Create (mobile)

`CreateMissionDto` : serviceId, title, description, localisation (`city`, `district`, `addressLine`, `locationNotes`, lat/lng), planning (`schedulingType`, dates, `startTime`, `selectedWeekdays`, `occurrences`, `durationKnown`), `workersNeeded`, pricing (`pricingType`, `rateScope`, `rateAmount`), legacy `clientPriceAmount`.

## Planning

`ONCE` | `CONSECUTIVE_DAYS` | `SELECTED_DAYS` → `MissionOccurrence`. Max **30 jours**. ONCE ≠ N occurrences.

## MissionMedia

Table prête : IMAGE, max 5, storage privé. Upload HTTP = sprint suivant.

## Paiement / refund

Lifecycle : DRAFT → PAYMENT_REQUIRED → (interne) PENDING_REVIEW → …

Si `paymentConfirmedAt` + `REJECTED` → `financialFollowUpRequired = true` (**Refund required — Payment module**). Aucun faux remboursement / email « remboursé ».
