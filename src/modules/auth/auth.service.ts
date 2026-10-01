import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountTokenType,
  LegalGuardianStatus,
  UserStatus,
} from '@prisma/client';
import type { CountryCode } from 'libphonenumber-js';
import {
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
} from '../../common/constants/terms';
import { assertMinimumAge, isMinor } from '../../common/utils/age';
import { generateOtpCode, sha256Hex } from '../../common/utils/crypto-tokens';
import { normalizeEmail } from '../../common/utils/email-normalize';
import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from '../../common/utils/password';
import { normalizePhoneToE164 } from '../../common/utils/phone';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import type { AuthConfig } from '../../config/configuration';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { toSafeUser } from './auth.serializer';
import type { AuthTokensResponse, SafeUser } from './auth.types';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { ForgotPasswordDto } from './dto/forgot-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import type { ResetPasswordDto } from './dto/reset-password.dto';
import type { SendPhoneCodeDto } from './dto/send-phone-code.dto';
import type { VerifyEmailDto } from './dto/verify-email.dto';
import type { VerifyPhoneDto } from './dto/verify-phone.dto';
import { SessionsService } from './sessions.service';
import { TokensService } from './tokens.service';

const INVALID_CREDENTIALS = 'Identifiants invalides';
const FORGOT_PASSWORD_MESSAGE =
  'Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly tokensService: TokensService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
    private readonly configService: ConfigService,
  ) {}

  private get authConfig(): AuthConfig {
    return this.configService.getOrThrow<AuthConfig>('auth');
  }

  private phoneRegion(): CountryCode {
    return (this.authConfig.defaultPhoneRegion || 'BJ') as CountryCode;
  }

  /**
   * Inscription.
   * ClientProfile n'est PAS créé ici (lazy / à la demande).
   * identityVerificationStatus reste UNVERIFIED.
   */
  async register(
    dto: RegisterDto,
    userAgent?: string | null,
  ): Promise<AuthTokensResponse> {
    if (!dto.acceptTerms) {
      throw new BadRequestException(
        'Vous devez accepter les conditions d’utilisation',
      );
    }

    const dateOfBirth = new Date(dto.dateOfBirth);
    if (Number.isNaN(dateOfBirth.getTime())) {
      throw new BadRequestException('Date de naissance invalide');
    }

    const age = assertMinimumAge(dateOfBirth, 16);
    const legalGuardianStatus = isMinor(dateOfBirth)
      ? LegalGuardianStatus.REQUIRED
      : LegalGuardianStatus.NOT_REQUIRED;

    const email = dto.email.trim();
    const emailNormalized = normalizeEmail(email);
    const phone = normalizePhoneToE164(dto.phone, this.phoneRegion());
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email,
            emailNormalized,
            phone,
            passwordHash,
            dateOfBirth,
            legalGuardianStatus,
            // identityVerificationStatus: défaut UNVERIFIED (Prisma)
            // ClientProfile : volontairement NON créé à l'inscription (lazy).
          },
        });

        await tx.termsAcceptance.create({
          data: {
            userId: created.id,
            termsVersion: TERMS_VERSION,
            privacyPolicyVersion: PRIVACY_POLICY_VERSION,
          },
        });

        return created;
      });

      const emailToken = await this.tokensService.createEmailVerificationToken(
        user.id,
      );
      await this.sendVerificationEmail(user.email, emailToken);

      const withJobber = { ...user, jobberProfile: null };
      void age;
      return this.sessionsService.issueTokensForUser(withJobber, { userAgent });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Un compte existe déjà avec cet email ou ce téléphone',
        );
      }
      throw error;
    }
  }

  async login(
    dto: LoginDto,
    userAgent?: string | null,
  ): Promise<AuthTokensResponse> {
    const emailNormalized = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
      include: { jobberProfile: true },
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (
      user.status === UserStatus.SUSPENDED ||
      user.status === UserStatus.CLOSED
    ) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const valid = await verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return this.sessionsService.issueTokensForUser(user, { userAgent });
  }

  async refresh(
    refreshToken: string,
    userAgent?: string | null,
  ): Promise<AuthTokensResponse> {
    const rotated = await this.sessionsService.rotateRefreshToken(
      refreshToken,
      userAgent,
    );

    if (!rotated) {
      throw new UnauthorizedException('Session invalide ou expirée');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: rotated.userId },
    });

    if (
      !user ||
      user.status === UserStatus.CLOSED ||
      user.status === UserStatus.SUSPENDED
    ) {
      await this.sessionsService.revokeAllUserSessions(rotated.userId);
      throw new UnauthorizedException('Session invalide ou expirée');
    }

    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.authConfig.jwtAccessTtl,
      user: rotated.user,
    };
  }

  async logout(
    userId: string,
    sessionId: string,
  ): Promise<{ message: string }> {
    await this.sessionsService.revokeSession(sessionId, userId);
    return { message: 'Déconnexion réussie' };
  }

  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.sessionsService.revokeAllUserSessions(userId);
    return { message: 'Déconnexion de toutes les sessions réussie' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const emailNormalized = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    if (user && user.status !== UserStatus.CLOSED) {
      try {
        const token = await this.tokensService.createPasswordResetToken(
          user.id,
        );
        await this.sendPasswordResetEmail(user.email, token);
      } catch (error) {
        this.logger.warn(
          `forgotPassword email failed for userId=${user.id}: ${String(error)}`,
        );
      }
    }

    return { message: FORGOT_PASSWORD_MESSAGE };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ message: string }> {
    validatePasswordPolicy(dto.password);

    const consumed = await this.tokensService.consumeToken(
      dto.token,
      AccountTokenType.PASSWORD_RESET,
    );
    if (!consumed) {
      throw new BadRequestException(
        'Jeton de réinitialisation invalide ou expiré',
      );
    }

    const passwordHash = await hashPassword(dto.password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: consumed.userId },
        data: { passwordHash },
      });
    });

    await this.sessionsService.revokeAllUserSessions(consumed.userId);

    return { message: 'Mot de passe mis à jour' };
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    sessionId: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Authentification requise');
    }

    const valid = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new BadRequestException('Mot de passe actuel incorrect');
    }

    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    await this.sessionsService.revokeAllUserSessions(userId);
    // Réémettre une session courante n'est pas requis ici — le client se reconnecte.
    void sessionId;

    return { message: 'Mot de passe modifié' };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<{ message: string }> {
    const consumed = await this.tokensService.consumeToken(
      dto.token,
      AccountTokenType.EMAIL_VERIFICATION,
    );
    if (!consumed) {
      throw new BadRequestException('Jeton de vérification invalide ou expiré');
    }

    await this.prisma.user.update({
      where: { id: consumed.userId },
      data: {
        emailVerifiedAt: new Date(),
        // identityVerificationStatus volontairement inchangé (reste UNVERIFIED)
      },
    });

    return { message: 'Email vérifié' };
  }

  async resendEmailVerification(email: string): Promise<{ message: string }> {
    const emailNormalized = normalizeEmail(email);
    const user = await this.prisma.user.findUnique({
      where: { emailNormalized },
    });

    // Message générique anti-énumération
    const message =
      'Si un compte existe pour cet email, un lien de vérification a été envoyé.';

    if (!user || user.emailVerifiedAt || user.status === UserStatus.CLOSED) {
      return { message };
    }

    try {
      const token = await this.tokensService.createEmailVerificationToken(
        user.id,
      );
      await this.sendVerificationEmail(user.email, token);
    } catch (error) {
      this.logger.warn(
        `resendEmailVerification failed userId=${user.id}: ${String(error)}`,
      );
    }

    return { message };
  }

  async sendPhoneCode(
    userId: string,
    dto: SendPhoneCodeDto,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Authentification requise');
    }

    const phone = dto.phone
      ? normalizePhoneToE164(dto.phone, this.phoneRegion())
      : user.phone;

    const code = generateOtpCode();
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(
      Date.now() + this.authConfig.otpTtlMinutes * 60 * 1000,
    );

    await this.prisma.phoneOtp.create({
      data: {
        userId,
        phone,
        codeHash,
        maxAttempts: this.authConfig.otpMaxAttempts,
        expiresAt,
      },
    });

    await this.smsService.send({
      to: phone,
      body: `Votre code KingJOBS : ${code}`,
      debugCode: code,
    });

    return { message: 'Code de vérification envoyé' };
  }

  async verifyPhone(
    userId: string,
    dto: VerifyPhoneDto,
  ): Promise<{ message: string }> {
    const otp = await this.prisma.phoneOtp.findFirst({
      where: {
        userId,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!otp) {
      throw new BadRequestException('Code invalide ou expiré');
    }

    if (otp.attempts >= otp.maxAttempts) {
      throw new BadRequestException('Nombre maximum de tentatives atteint');
    }

    const codeHash = sha256Hex(dto.code.trim());
    if (codeHash !== otp.codeHash) {
      await this.prisma.phoneOtp.update({
        where: { id: otp.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Code invalide ou expiré');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.phoneOtp.update({
        where: { id: otp.id },
        data: { consumedAt: new Date() },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          phone: otp.phone,
          phoneVerifiedAt: new Date(),
          // identityVerificationStatus volontairement inchangé
        },
      });
    });

    return { message: 'Téléphone vérifié' };
  }

  async getSafeUserById(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { jobberProfile: true },
    });
    if (!user) {
      throw new UnauthorizedException('Authentification requise');
    }
    if (user.status === UserStatus.CLOSED) {
      throw new ForbiddenException('Ce compte est fermé');
    }
    return toSafeUser(user);
  }

  async updateMe(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<SafeUser> {
    const update: {
      firstName?: string;
      lastName?: string;
      email?: string;
      emailNormalized?: string;
      emailVerifiedAt?: Date | null;
      phone?: string;
      phoneVerifiedAt?: Date | null;
    } = {};

    if (data.firstName !== undefined) update.firstName = data.firstName.trim();
    if (data.lastName !== undefined) update.lastName = data.lastName.trim();

    if (data.email !== undefined) {
      update.email = data.email.trim();
      update.emailNormalized = normalizeEmail(data.email);
      update.emailVerifiedAt = null;
    }
    if (data.phone !== undefined) {
      update.phone = normalizePhoneToE164(data.phone, this.phoneRegion());
      update.phoneVerifiedAt = null;
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: update,
        include: { jobberProfile: true },
      });

      if (data.email !== undefined) {
        const token = await this.tokensService.createEmailVerificationToken(
          user.id,
        );
        await this.sendVerificationEmail(user.email, token);
      }

      return toSafeUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Un compte existe déjà avec cet email ou ce numéro',
        );
      }
      throw error;
    }
  }

  async closeAccount(
    userId: string,
    password: string,
  ): Promise<{ message: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException('Mot de passe incorrect');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.CLOSED, closedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    return { message: 'Compte fermé' };
  }

  async activateJobber(userId: string) {
    const existing = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      return {
        id: existing.id,
        status: existing.status,
        bio: existing.bio,
      };
    }

    const created = await this.prisma.jobberProfile.create({
      data: { userId, status: 'DRAFT' },
    });
    return {
      id: created.id,
      status: created.status,
      bio: created.bio,
    };
  }

  async getJobberMe(userId: string) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    return {
      id: profile.id,
      status: profile.status,
      bio: profile.bio,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async updateJobberMe(userId: string, bio?: string) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    const updated = await this.prisma.jobberProfile.update({
      where: { userId },
      data: { bio: bio === undefined ? undefined : bio.trim() || null },
    });
    return {
      id: updated.id,
      status: updated.status,
      bio: updated.bio,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  private async sendVerificationEmail(
    to: string,
    token: string,
  ): Promise<void> {
    const link = `${this.authConfig.appWebUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.emailService.send({
      to,
      subject: 'Vérifiez votre email KingJOBS',
      html: `<p>Bienvenue sur KingJOBS.</p><p><a href="${link}">Vérifier mon email</a></p>`,
      text: `Vérifiez votre email : ${link}`,
      debugToken: token,
    });
  }

  private async sendPasswordResetEmail(
    to: string,
    token: string,
  ): Promise<void> {
    const link = `${this.authConfig.appWebUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.emailService.send({
      to,
      subject: 'Réinitialisation de mot de passe KingJOBS',
      html: `<p>Réinitialisez votre mot de passe :</p><p><a href="${link}">Choisir un nouveau mot de passe</a></p>`,
      text: `Réinitialisez votre mot de passe : ${link}`,
      debugToken: token,
    });
  }
}
