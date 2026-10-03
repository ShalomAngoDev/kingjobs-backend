import { NotFoundException } from '@nestjs/common';
import { Prisma, UserNotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const create = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const findFirst = jest.fn();
  const update = jest.fn();
  const updateMany = jest.fn();

  const prisma = {
    userNotification: {
      create,
      findMany,
      count,
      findFirst,
      update,
      updateMany,
    },
  };

  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationsService(prisma as never);
  });

  it('createIfAbsent crée une notification', async () => {
    const row = {
      id: 'n1',
      userId: 'u1',
      type: UserNotificationType.JOBBER_PROFILE_VERIFIED,
      title: 'Votre profil est vérifié',
      message: 'ok',
      dedupeKey: 'jobber-profile-verified:c1',
      actionUrl: '/espace-jobber',
      readAt: null,
      createdAt: new Date('2026-10-02T12:00:00Z'),
    };
    create.mockResolvedValue(row);

    const result = await service.createIfAbsent({
      userId: 'u1',
      type: UserNotificationType.JOBBER_PROFILE_VERIFIED,
      title: row.title,
      message: row.message,
      dedupeKey: row.dedupeKey,
      actionUrl: row.actionUrl,
    });

    expect(result).toEqual(row);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('createIfAbsent est idempotent sur violation unique', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await service.createIfAbsent({
      userId: 'u1',
      type: UserNotificationType.JOBBER_PROFILE_VERIFIED,
      title: 't',
      message: 'm',
      dedupeKey: 'jobber-profile-verified:c1',
    });
    expect(result).toBeNull();
  });

  it('markRead refuse une notification d’un autre user', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.markRead('u1', 'n-other')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('markRead marque comme lue pour le propriétaire', async () => {
    const existing = {
      id: 'n1',
      userId: 'u1',
      type: UserNotificationType.JOBBER_PROFILE_VERIFIED,
      title: 't',
      message: 'm',
      actionUrl: null,
      readAt: null,
      createdAt: new Date('2026-10-02T12:00:00Z'),
    };
    findFirst.mockResolvedValue(existing);
    update.mockResolvedValue({
      ...existing,
      readAt: new Date('2026-10-02T13:00:00Z'),
    });

    const result = await service.markRead('u1', 'n1');
    expect(result.unread).toBe(false);
    expect(result.readAt).toBe('2026-10-02T13:00:00.000Z');
  });

  it('unreadCount compte uniquement les non lues du user', async () => {
    count.mockResolvedValue(2);
    await expect(service.unreadCount('u1')).resolves.toEqual({ count: 2 });
    expect(count).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null },
    });
  });

  it('listForUser filtre par espace et réécrit IDENTITY_VERIFIED', async () => {
    const row = {
      id: 'n1',
      userId: 'u1',
      type: UserNotificationType.IDENTITY_VERIFIED,
      title: 'Votre identité est vérifiée',
      message: 'ok',
      actionUrl: '/espace-jobber',
      readAt: null,
      createdAt: new Date('2026-10-02T12:00:00Z'),
    };
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(1);

    const result = await service.listForUser('u1', 20, 1, 'client');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          type: {
            in: [
              UserNotificationType.IDENTITY_VERIFIED,
              UserNotificationType.MISSION_APPLICATION_RECEIVED,
            ],
          },
        },
      }),
    );
    expect(result.items[0].actionUrl).toBe('/espace-client');
  });

  it('markAllRead filtre par espace Jobber', async () => {
    updateMany.mockResolvedValue({ count: 3 });
    await expect(service.markAllRead('u1', 'jobber')).resolves.toEqual({
      updated: 3,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        type: {
          in: [
            UserNotificationType.IDENTITY_VERIFIED,
            UserNotificationType.JOBBER_PROFILE_VERIFIED,
            UserNotificationType.JOBBER_VERIFICATION_NEEDS_CHANGES,
            UserNotificationType.JOBBER_VERIFICATION_REJECTED,
            UserNotificationType.JOBBER_APPLICATION_SELECTED,
            UserNotificationType.JOBBER_APPLICATION_REJECTED,
            UserNotificationType.JOBBER_MISSION_FILLED,
          ],
        },
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });
});
