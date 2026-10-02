# Mission — revue KingJOBS (BO04 / BO04.1)

## Cycle

```
DRAFT → PAYMENT_REQUIRED → PENDING_REVIEW
  → PUBLISHED | NEEDS_CHANGES | REJECTED
NEEDS_CHANGES → (resubmit) PENDING_REVIEW   # sans repaiement
```

## Admin API

`GET /admin/missions`, `counts`, `:id`, `approve`, `request-changes`, `reject`.

Détail Admin affiche : Jobbers, mode, **portée** (par personne / budget global), montant saisi, brut/Jobber, estimation totale.

## Refund on rejection

| Condition | Action V1 |
| --- | --- |
| `paymentConfirmedAt` + REJECTED | `financialFollowUpRequired = true` |
| Email Client | Pas de « remboursé » ; mention traitement financier conforme processus KingJOBS |

Automatisation = module Payment futur.

## Seed démo BO04.1

- **A** : Plomberie, 1 Jobber, FIXED PER_JOBBER 10 000, PENDING_REVIEW
- **B** : Nettoyage, 10 Jobbers, HOURLY TOTAL 20 000/h, 4 h → 8 000/Jobber, 80 000 total
