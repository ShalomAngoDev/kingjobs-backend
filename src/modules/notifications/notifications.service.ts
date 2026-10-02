import { Injectable, NotFoundException } from '@nestjs/common';
import { UserNotificationType, type Prisma } from '@prisma/client';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type CreateNotificationInput = {
  userId: string;
  type: UserNotificationType;
  title: string;
  message: string;
  /** Idempotence : même clé + userId = pas de doublon. */
  dedupeKey: string;
  actionUrl?: string | null;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crée une notification si la clé d'idempotence n'existe pas encore.
   * Retourne null si déjà créée (rejeu / double action).
   */
  async createIfAbsent(input: CreateNotificationInput) {
    try {
      return await this.prisma.userNotification.create({
        data: {
          userId: input.userId,
          type: input.type,
          title: input.title,
          message: input.message,
          dedupeKey: input.dedupeKey,
          actionUrl: input.actionUrl ?? null,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async listForUser(userId: string, limit = 20, page = 1) {
    const take = Math.min(Math.max(limit, 1), 50);
    const currentPage = Math.max(page, 1);
    const skip = (currentPage - 1) * take;
    const [items, total] = await Promise.all([
      this.prisma.userNotification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.userNotification.count({ where: { userId } }),
    ]);
    return {
      items: items.map(serializeNotification),
      page: currentPage,
      limit: take,
      total,
    };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.userNotification.count({
      where: { userId, readAt: null },
    });
    return { count };
  }

  async markRead(userId: string, id: string) {
    const existing = await this.prisma.userNotification.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Notification introuvable');
    }
    if (existing.readAt) {
      return serializeNotification(existing);
    }
    const updated = await this.prisma.userNotification.update({
      where: { id: existing.id },
      data: { readAt: new Date() },
    });
    return serializeNotification(updated);
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.userNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}

function serializeNotification(row: {
  id: string;
  type: UserNotificationType;
  title: string;
  message: string;
  actionUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    actionUrl: row.actionUrl,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    unread: row.readAt === null,
  };
}

export type NotificationRow = Prisma.UserNotificationGetPayload<object>;
