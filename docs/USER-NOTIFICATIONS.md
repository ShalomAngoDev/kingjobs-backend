# User notifications (in-app)

Système générique Client + Jobber. Canaux séparés : email, SMS, push (hors scope V1 web).

## Modèle

`UserNotification` : `type`, `title`, `message`, `dedupeKey`, `actionUrl?`, `readAt?`.

Pas de notes Admin, pas d'URLs documents privés, pas de données KYC.

## Types

| Type | Déclencheur |
|---|---|
| `JOBBER_PROFILE_VERIFIED` | Approve dossier JOBBER_PROFILE |
| `JOBBER_VERIFICATION_NEEDS_CHANGES` | Request changes Jobber |
| `JOBBER_VERIFICATION_REJECTED` | Reject Jobber |
| `IDENTITY_VERIFIED` | Approve IDENTITY seul |
| `MISSION_APPLICATION_RECEIVED` | Nouvelle candidature → Client |
| `JOBBER_APPLICATION_SELECTED` | Client sélectionne le Jobber |
| `JOBBER_APPLICATION_REJECTED` | Client refuse la candidature |
| `JOBBER_MISSION_FILLED` | Places pourvues (pas un rejet personnel) |

## API (`/api/v1`)

| Méthode | Route |
|---|---|
| GET | `/users/me/notifications?page=&limit=` |
| GET | `/users/me/notifications/unread-count` |
| POST | `/users/me/notifications/:id/read` |
| POST | `/users/me/notifications/read-all` |

Ownership strict `userId = currentUser`.

## Idempotence

`createIfAbsent` + unique `(userId, dedupeKey)`.

## Profile summary

`GET /jobbers/me/profile-summary` : displayName, photo APPROVED, verification, primaryServices, `completedMissionsCount` (assignments ACTIVE + mission COMPLETED).

## Migration enum candidature

`20261002196000_webapp_ui03_notification_types` : DEV (Docker) uniquement. **Pas de deploy Neon automatique.**
