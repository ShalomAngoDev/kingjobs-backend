import { UserNotificationType } from '@prisma/client';
import {
  resolveNotificationActionUrl,
  typesForSpace,
} from './notification-spaces';

describe('notification-spaces', () => {
  it('sépare les types Client / Jobber (identité partagée)', () => {
    const client = typesForSpace('client')!;
    const jobber = typesForSpace('jobber')!;
    expect(client).toContain(UserNotificationType.IDENTITY_VERIFIED);
    expect(client).toContain(UserNotificationType.MISSION_APPLICATION_RECEIVED);
    expect(client).not.toContain(UserNotificationType.JOBBER_PROFILE_VERIFIED);

    expect(jobber).toContain(UserNotificationType.IDENTITY_VERIFIED);
    expect(jobber).toContain(UserNotificationType.JOBBER_PROFILE_VERIFIED);
    expect(jobber).not.toContain(
      UserNotificationType.MISSION_APPLICATION_RECEIVED,
    );
  });

  it('réécrit IDENTITY_VERIFIED selon l’espace même si stocké Jobber', () => {
    expect(
      resolveNotificationActionUrl(
        UserNotificationType.IDENTITY_VERIFIED,
        '/espace-jobber',
        'client',
      ),
    ).toBe('/espace-client');
    expect(
      resolveNotificationActionUrl(
        UserNotificationType.IDENTITY_VERIFIED,
        null,
        'jobber',
      ),
    ).toBe('/espace-jobber');
  });
});
