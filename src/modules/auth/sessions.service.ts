import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { AuthConfig } from '../../config/configuration';
import {
  generateOpaqueToken,
  sha256Hex,
} from '../../common/utils/crypto-tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuthTokensResponse, JwtPayload, SafeUser } from './auth.types';
import { toSafeUser } from './auth.serializer';

type CreateSessionInput = {
  userId: string;
  userAgent?: string | null;
  tokenFamily?: string;
};

type SessionUser = Parameters<typeof toSafeUser>[0];

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get authConfig(): AuthConfig {
    return this.configService.getOrThrow<AuthConfig>('auth');
  }

  private refreshExpiresAt(from: Date = new Date()): Date {
    const days = this.authConfig.refreshTokenTtlDays;
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }

  async issueTokensForUser(
    user: SessionUser,
    options?: { userAgent?: string | null },
  ): Promise<AuthTokensResponse> {
    const session = await this.createSession({
      userId: user.id,
      userAgent: options?.userAgent,
    });

    const accessToken = await this.signAccessToken(user.id, session.id);

    return {
      accessToken,
      refreshToken: session.rawRefreshToken,
      tokenType: 'Bearer',
      expiresIn: this.authConfig.jwtAccessTtl,
      user: toSafeUser(user),
    };
  }

  async createSession(input: CreateSessionInput): Promise<{
    id: string;
    rawRefreshToken: string;
    tokenFamily: string;
  }> {
    const rawRefreshToken = generateOpaqueToken(32);
    const refreshTokenHash = sha256Hex(rawRefreshToken);
    const tokenFamily = input.tokenFamily ?? randomUUID();

    const session = await this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash,
        tokenFamily,
        expiresAt: this.refreshExpiresAt(),
        userAgent: input.userAgent ?? null,
      },
    });

    return {
      id: session.id,
      rawRefreshToken,
      tokenFamily: session.tokenFamily,
    };
  }

  async signAccessToken(userId: string, sessionId: string): Promise<string> {
    const payload: JwtPayload = { sub: userId, sid: sessionId };
    return this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtAccessSecret,
      expiresIn: this.authConfig.jwtAccessTtl as `${number}m`,
    });
  }

  /**
   * Rotation du refresh token.
   * Réutilisation d'un token déjà révoqué → révocation de toute la famille.
   */
  async rotateRefreshToken(
    rawRefreshToken: string,
    userAgent?: string | null,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    sessionId: string;
    userId: string;
    user: SafeUser;
  } | null> {
    const refreshTokenHash = sha256Hex(rawRefreshToken);
    const existing = await this.prisma.session.findUnique({
      where: { refreshTokenHash },
      include: {
        user: { include: { jobberProfile: true } },
      },
    });

    if (!existing) {
      return null;
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.tokenFamily);
      return null;
    }

    if (existing.expiresAt.getTime() < Date.now()) {
      await this.prisma.session.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    const newRaw = generateOpaqueToken(32);
    const newHash = sha256Hex(newRaw);

    const rotated = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({
        data: {
          userId: existing.userId,
          refreshTokenHash: newHash,
          tokenFamily: existing.tokenFamily,
          expiresAt: this.refreshExpiresAt(),
          userAgent: userAgent ?? existing.userAgent,
        },
      });

      await tx.session.update({
        where: { id: existing.id },
        data: {
          revokedAt: new Date(),
          replacedById: created.id,
        },
      });

      return created;
    });

    const accessToken = await this.signAccessToken(existing.userId, rotated.id);

    return {
      accessToken,
      refreshToken: newRaw,
      sessionId: rotated.id,
      userId: existing.userId,
      user: toSafeUser(existing.user),
    };
  }

  async revokeSession(sessionId: string, userId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        ...(userId ? { userId } : {}),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(tokenFamily: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenFamily, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
