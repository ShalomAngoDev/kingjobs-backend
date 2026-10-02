# Stockage privé KYC (BACK-OFFICE 03.1)

## Abstraction

`FileStorageService` (`infrastructure/storage/`) :

| Provider | Usage |
| --- | --- |
| `local_private` | Dev / Docker uniquement |
| `object_storage` | Production (S3-compatible générique) |
| `memory` | Tests unitaires |

Fail-fast : `NODE_ENV=production` + `STORAGE_PROVIDER=local_private` → refus de démarrage.

## Configuration

Voir `.env.example` : `STORAGE_PROVIDER`, `S3_*`, `STORAGE_SIGNED_URL_TTL_SECONDS` (défaut 180s), `STORAGE_MAX_UPLOAD_BYTES` (défaut 8 Mo).

Bucket **privé** (pas de `public-read`). Secrets jamais loggés.

## Clés

Format : `verification/{sha256(userId)[0:16]}/{uuid}` — sans PII.

Filename original : metadata sanitizée uniquement (`sanitizeOriginalFilename`), jamais la clé.

## Upload

Contrôles : auth, ownership (pas de `userId` arbitraire), type DocumentType, MIME allowlist (JPEG/PNG/WebP/PDF), magic bytes, taille max.

`IDENTITY_DOCUMENT` : legacy, **refus** des nouvelles soumissions → CIP ou PASSPORT.

Selfie : image + `capturedAt` / event `source=LIVE_CAPTURE`. Pas de claim « liveness verified ».

Remplacement : **nouvelle clé** ; ancien document → `EXPIRED`. Pas de purge physique auto (rétention à finaliser).

Échec DB après put : `delete(key)` compensatoire.

## Consultation

Streaming Backend authentifié (`Cache-Control: private, no-store`).

Option `getSignedUrl` sur object_storage (TTL court, jamais persisté). V1 Admin/User = stream.

Audit Admin sensible : `VIEW_VERIFICATION_DOCUMENT` (CIP, PASSPORT, résidence, selfie) sans contenu.

## country_code

Champ adresse / pays de résidence (≠ nationalité). Interim : DEFAULT `BJ` (marché). Follow-up : nullable sans default.
