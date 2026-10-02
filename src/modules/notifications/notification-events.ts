import { UserNotificationType } from '@prisma/client';
import type { NotificationsService } from './notifications.service';

/** Helpers métier : titres / messages visibles User (jamais de note interne). */

export async function notifyJobberProfileVerified(
  notifications: NotificationsService,
  userId: string,
  caseId: string,
) {
  return notifications.createIfAbsent({
    userId,
    type: UserNotificationType.JOBBER_PROFILE_VERIFIED,
    title: 'Votre profil est vérifié',
    message:
      'Votre profil KingJOBS a été vérifié. Vous pouvez maintenant candidater aux missions pour lesquelles vous êtes éligible.',
    dedupeKey: `jobber-profile-verified:${caseId}`,
    actionUrl: '/espace-jobber/profil',
  });
}

export async function notifyJobberNeedsChanges(
  notifications: NotificationsService,
  userId: string,
  caseId: string,
  reviewedAtIso: string,
) {
  return notifications.createIfAbsent({
    userId,
    type: UserNotificationType.JOBBER_VERIFICATION_NEEDS_CHANGES,
    title: 'Votre profil doit être complété',
    message:
      'Des modifications sont nécessaires avant la validation de votre profil.',
    dedupeKey: `jobber-needs-changes:${caseId}:${reviewedAtIso}`,
    actionUrl: '/espace-jobber/verification',
  });
}

export async function notifyJobberRejected(
  notifications: NotificationsService,
  userId: string,
  caseId: string,
  userMessage?: string | null,
) {
  const message =
    userMessage?.trim() ||
    'Votre dossier ne peut pas être validé dans son état actuel.';
  return notifications.createIfAbsent({
    userId,
    type: UserNotificationType.JOBBER_VERIFICATION_REJECTED,
    title: 'Décision sur votre dossier',
    message,
    dedupeKey: `jobber-rejected:${caseId}`,
    actionUrl: '/espace-jobber/profil',
  });
}

export async function notifyIdentityVerified(
  notifications: NotificationsService,
  userId: string,
  caseId: string,
) {
  return notifications.createIfAbsent({
    userId,
    type: UserNotificationType.IDENTITY_VERIFIED,
    title: 'Votre identité est vérifiée',
    message: 'Votre identité KingJOBS a été vérifiée.',
    dedupeKey: `identity-verified:${caseId}`,
    actionUrl: '/espace-jobber',
  });
}

export async function notifyClientApplicationReceived(
  notifications: NotificationsService,
  clientUserId: string,
  applicationId: string,
  missionTitle: string,
) {
  return notifications.createIfAbsent({
    userId: clientUserId,
    type: UserNotificationType.MISSION_APPLICATION_RECEIVED,
    title: 'Nouvelle candidature',
    message: `Vous avez reçu une nouvelle candidature pour votre mission « ${missionTitle} ».`,
    dedupeKey: `mission-application-received:${applicationId}`,
    actionUrl: '/espace-client',
  });
}

export async function notifyJobberApplicationSelected(
  notifications: NotificationsService,
  jobberUserId: string,
  applicationId: string,
  missionId: string,
  missionTitle: string,
) {
  return notifications.createIfAbsent({
    userId: jobberUserId,
    type: UserNotificationType.JOBBER_APPLICATION_SELECTED,
    title: 'Vous avez été sélectionné',
    message: `Votre candidature pour « ${missionTitle} » a été retenue.`,
    dedupeKey: `jobber-application-selected:${applicationId}`,
    actionUrl: `/espace-jobber/missions/${missionId}`,
  });
}

export async function notifyJobberApplicationRejected(
  notifications: NotificationsService,
  jobberUserId: string,
  applicationId: string,
  missionId: string,
  missionTitle: string,
) {
  return notifications.createIfAbsent({
    userId: jobberUserId,
    type: UserNotificationType.JOBBER_APPLICATION_REJECTED,
    title: 'Candidature non retenue',
    message: `Votre candidature pour « ${missionTitle} » n’a pas été retenue.`,
    dedupeKey: `jobber-application-rejected:${applicationId}`,
    actionUrl: `/espace-jobber/missions/${missionId}`,
  });
}

export async function notifyJobberMissionFilled(
  notifications: NotificationsService,
  jobberUserId: string,
  applicationId: string,
  missionId: string,
) {
  return notifications.createIfAbsent({
    userId: jobberUserId,
    type: UserNotificationType.JOBBER_MISSION_FILLED,
    title: 'Mission pourvue',
    message: 'La mission a trouvé les Jobbers recherchés.',
    dedupeKey: `jobber-mission-filled:${applicationId}`,
    actionUrl: `/espace-jobber/missions/${missionId}`,
  });
}
