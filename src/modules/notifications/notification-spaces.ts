import { UserNotificationType } from '@prisma/client';

export type NotificationSpace = 'client' | 'jobber';

/** Types visibles dans l'espace Client (identité User + missions Client). */
export const CLIENT_NOTIFICATION_TYPES: readonly UserNotificationType[] = [
  UserNotificationType.IDENTITY_VERIFIED,
  UserNotificationType.MISSION_APPLICATION_RECEIVED,
] as const;

/** Types visibles dans l'espace Jobber (identité User + parcours Jobber). */
export const JOBBER_NOTIFICATION_TYPES: readonly UserNotificationType[] = [
  UserNotificationType.IDENTITY_VERIFIED,
  UserNotificationType.JOBBER_PROFILE_VERIFIED,
  UserNotificationType.JOBBER_VERIFICATION_NEEDS_CHANGES,
  UserNotificationType.JOBBER_VERIFICATION_REJECTED,
  UserNotificationType.JOBBER_APPLICATION_SELECTED,
  UserNotificationType.JOBBER_APPLICATION_REJECTED,
  UserNotificationType.JOBBER_MISSION_FILLED,
] as const;

export function isNotificationSpace(
  value: string | undefined | null,
): value is NotificationSpace {
  return value === 'client' || value === 'jobber';
}

export function typesForSpace(
  space: NotificationSpace | undefined,
): readonly UserNotificationType[] | undefined {
  if (space === 'client') return CLIENT_NOTIFICATION_TYPES;
  if (space === 'jobber') return JOBBER_NOTIFICATION_TYPES;
  return undefined;
}

/**
 * Lien d'action cohérent avec l'espace consulté.
 * L'identité est User-level : même notif, destinations distinctes.
 */
export function resolveNotificationActionUrl(
  type: UserNotificationType,
  stored: string | null,
  space: NotificationSpace | undefined,
): string | null {
  if (type === UserNotificationType.IDENTITY_VERIFIED) {
    if (space === 'client') return '/espace-client';
    if (space === 'jobber') return '/espace-jobber';
    return stored ?? '/espace-client';
  }
  return stored;
}
