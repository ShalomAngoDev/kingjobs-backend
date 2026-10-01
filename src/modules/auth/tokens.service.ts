import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountTokenType } from '@prisma/client';
import type { AuthConfig } from '../../config/configuration';
import {
  generateOpaqueToken,
  sha256Hex,
} from '../../common/utils/crypto-tokens';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class TokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private get authConfig(): AuthConfig {
    return this.configService.getOrThrow<AuthConfig>('auth');
  }

  async createEmailVerificationToken(userId: string): Promise<string> {
    return this.createToken(
      userId,
      AccountTokenType.EMAIL_VERIFICATION,
      this.authConfig.emailVerifyTtlHours * 60 * 60 * 1000,
    );
  }

  async createPasswordResetToken(userId: string): Promise<string> {
    return this.createToken(
      userId,
      AccountTokenType.PASSWORD_RESET,
      this.authConfig.passwordResetTtlMinutes * 60 * 1000,
    );
  }

  private async createToken(
    userId: string,
    type: AccountTokenType,
    ttlMs: number,
  ): Promise<string> {
    const raw = generateOpaqueToken(32);
    const tokenHash = sha256Hex(raw);

    await this.prisma.$transaction(async (tx) => {
      await tx.accountToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      });

      await tx.accountToken.create({
        data: {
          userId,
          type,
          tokenHash,
          expiresAt: new Date(Date.now() + ttlMs),
        },
      });
    });

    return raw;
  }

  async consumeToken(
    rawToken: string,
    type: AccountTokenType,
  ): Promise<{ userId: string; tokenId: string } | null> {
    const tokenHash = sha256Hex(rawToken);
    const token = await this.prisma.accountToken.findUnique({
      where: { tokenHash },
    });

    if (!token || token.type !== type) {
      return null;
    }
    if (token.usedAt) {
      return null;
    }
    if (token.expiresAt.getTime() < Date.now()) {
      return null;
    }

    await this.prisma.accountToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    });

    return { userId: token.userId, tokenId: token.id };
  }
}
