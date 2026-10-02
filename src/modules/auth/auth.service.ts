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
  type JobberStatus,
} from '@prisma/client';
import {
  PRIVACY_POLICY_VERSION,
  TERMS_VERSION,
} from '../../common/constants/terms';
import {
  DEFAULT_COUNTRY_CODE,
  isSupportedCountryCode,
  toLibPhoneCountry,
  type SupportedCountryCode,
} from '../../common/constants/supported-countries';
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
const INVALID_PHONE_CREDENTIALS =
  'Numéro de téléphone ou mot de passe incorrect.';
const FORGOT_PASSWORD_MESSAGE =
  'Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.';
const USER_PROFILE_INCLUDE = {
  jobberProfile: true,
  clientProfile: true,
} as const;

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

  private phoneRegion(
    countryCode?: string | null,
  ): SupportedCountryCode {
    if (isSupportedCountryCode(countryCode)) {
      return countryCode;
    }
    const fallback = this.authConfig.defaultPhoneRegion || DEFAULT_COUNTRY_CODE;
    return isSupportedCountryCode(fallback) ? fallback : DEFAULT_COUNTRY_CODE;
  }

  /**
   * Inscription WEBAPP-01.
   * Téléphone = identifiant principal. Email facultatif (jamais synthétique).
   * countryCode = BJ | CI | TG (stocké + utilisé pour normalisation).
   * DOB optionnelle (complétion profil ultérieure).
   * ClientProfile / JobberProfile non créés ici.
   * identityVerificationStatus reste UNVERIFIED ; phoneVerifiedAt reste null.
   */
  async register(
    dto: RegisterDto,
    userAgent?: string | null,
  ): Promise<AuthTokensResponse> {
    if (!dto.acceptTerms) {
      throw new BadRequestException(
        'Vous devez accepter les Conditions Générales d’Utilisation.',
      );
    }

    if (!isSupportedCountryCode(dto.countryCode)) {
      throw new BadRequestException(
        'Pays non supporté. Choisissez Bénin, Côte d’Ivoire ou Togo.',
      );
    }
    const countryCode = dto.countryCode;

    let dateOfBirth: Date | null = null;
    let legalGuardianStatus: LegalGuardianStatus =
      LegalGuardianStatus.NOT_REQUIRED;

    if (dto.dateOfBirth != null && String(dto.dateOfBirth).trim() !== '') {
      dateOfBirth = new Date(dto.dateOfBirth);
      if (Number.isNaN(dateOfBirth.getTime())) {
        throw new BadRequestException('Date de naissance invalide');
      }
      assertMinimumAge(dateOfBirth, 16);
      legalGuardianStatus = isMinor(dateOfBirth)
        ? LegalGuardianStatus.REQUIRED
        : LegalGuardianStatus.NOT_REQUIRED;
    }

    const emailRaw =
      dto.email != null && String(dto.email).trim() !== ''
        ? String(dto.email).trim()
        : null;
    const emailNormalized = emailRaw ? normalizeEmail(emailRaw) : null;
    const phone = normalizePhoneToE164(
      dto.phone,
      toLibPhoneCountry(countryCode),
      { expectedCountry: countryCode },
    );
    const passwordHash = await hashPassword(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            firstName: dto.firstName.trim(),
            lastName: dto.lastName.trim(),
            email: emailRaw,
            emailNormalized,
            phone,
            countryCode,
            passwordHash,
            dateOfBirth,
            legalGuardianStatus,
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

      if (user.email) {
        try {
          const emailToken =
            await this.tokensService.createEmailVerificationToken(user.id);
          await this.sendVerificationEmail(user.email, emailToken);
        } catch (error) {
          this.logger.warn(
            `register email verification skipped userId=${user.id}: ${String(error)}`,
          );
        }
      }

      return this.sessionsService.issueTokensForUser(
        { ...user, jobberProfile: null, clientProfile: null },
        { userAgent },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Un compte existe déjà avec cet email ou ce téléphone',
        );
      }
      throw error;
    }
  }

  /**
   * Connexion User (téléphone) ou Admin (email).
   * Messages génériques anti-énumération.
   */
  async login(
    dto: LoginDto,
    userAgent?: string | null,
  ): Promise<AuthTokensResponse> {
    const phoneRaw = dto.phone?.trim();
    const emailRaw = dto.email?.trim();

    if (!phoneRaw && !emailRaw) {
      throw new BadRequestException(
        'Indiquez votre numéro de téléphone ou votre email.',
      );
    }

    const invalidMessage = phoneRaw
      ? INVALID_PHONE_CREDENTIALS
      : INVALID_CREDENTIALS;

    let user;
    if (phoneRaw) {
      const region = this.phoneRegion(dto.countryCode);
      const phone = normalizePhoneToE164(phoneRaw, toLibPhoneCountry(region), {
        expectedCountry: isSupportedCountryCode(dto.countryCode)
          ? dto.countryCode
          : undefined,
      });
      user = await this.prisma.user.findUnique({
        where: { phone },
        include: USER_PROFILE_INCLUDE,
      });
    } else {
      const emailNormalized = normalizeEmail(emailRaw!);
      user = await this.prisma.user.findUnique({
        where: { emailNormalized },
        include: USER_PROFILE_INCLUDE,
      });
    }

    if (!user) {
      throw new UnauthorizedException(invalidMessage);
    }

    if (
      user.status === UserStatus.SUSPENDED ||
      user.status === UserStatus.CLOSED
    ) {
      throw new UnauthorizedException(invalidMessage);
    }

    const valid = await verifyPassword(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException(invalidMessage);
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

    if (user && user.status !== UserStatus.CLOSED && user.email) {
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

    if (!user || user.emailVerifiedAt || user.status === UserStatus.CLOSED || !user.email) {
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
      ? normalizePhoneToE164(dto.phone, toLibPhoneCountry(this.phoneRegion()))
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
      include: USER_PROFILE_INCLUDE,
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
      dateOfBirth?: string | null;
    },
  ): Promise<SafeUser> {
    const update: {
      firstName?: string;
      lastName?: string;
      email?: string | null;
      emailNormalized?: string | null;
      emailVerifiedAt?: Date | null;
      phone?: string;
      phoneVerifiedAt?: Date | null;
      dateOfBirth?: Date | null;
      legalGuardianStatus?: LegalGuardianStatus;
    } = {};

    if (data.firstName !== undefined) update.firstName = data.firstName.trim();
    if (data.lastName !== undefined) update.lastName = data.lastName.trim();

    if (data.dateOfBirth !== undefined) {
      if (data.dateOfBirth === null || String(data.dateOfBirth).trim() === '') {
        update.dateOfBirth = null;
        update.legalGuardianStatus = LegalGuardianStatus.NOT_REQUIRED;
      } else {
        const dob = new Date(data.dateOfBirth);
        if (Number.isNaN(dob.getTime())) {
          throw new BadRequestException('Date de naissance invalide');
        }
        assertMinimumAge(dob, 16);
        update.dateOfBirth = dob;
        update.legalGuardianStatus = isMinor(dob)
          ? LegalGuardianStatus.REQUIRED
          : LegalGuardianStatus.NOT_REQUIRED;
      }
    }

    if (data.email !== undefined) {
      const emailRaw = data.email.trim();
      if (!emailRaw) {
        throw new BadRequestException('Email invalide');
      }
      update.email = emailRaw;
      update.emailNormalized = normalizeEmail(emailRaw);
      update.emailVerifiedAt = null;
    }
    if (data.phone !== undefined) {
      update.phone = normalizePhoneToE164(
        data.phone,
        toLibPhoneCountry(this.phoneRegion()),
      );
      update.phoneVerifiedAt = null;
    }

    try {
      const user = await this.prisma.user.update({
        where: { id: userId },
        data: update,
        include: USER_PROFILE_INCLUDE,
      });

      if (data.email !== undefined && user.email) {
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

  private serializeJobberProfile(profile: {
    id: string;
    status: JobberStatus;
    headline: string | null;
    bio: string | null;
    yearsOfExperience: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: profile.id,
      status: profile.status,
      headline: profile.headline,
      bio: profile.bio,
      yearsOfExperience: profile.yearsOfExperience,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async activateJobber(userId: string) {
    const existing = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      return this.serializeJobberProfile(existing);
    }

    try {
      const created = await this.prisma.jobberProfile.create({
        data: { userId, status: 'DRAFT' },
      });
      return this.serializeJobberProfile(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.jobberProfile.findUniqueOrThrow({
          where: { userId },
        });
        return this.serializeJobberProfile(again);
      }
      throw error;
    }
  }

  /**
   * Active le parcours Client sur le User existant (lazy, idempotent).
   * Ne crée pas un deuxième User.
   */
  async activateClient(userId: string) {
    const existing = await this.prisma.clientProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      return {
        id: existing.id,
        createdAt: existing.createdAt.toISOString(),
        updatedAt: existing.updatedAt.toISOString(),
      };
    }

    try {
      const created = await this.prisma.clientProfile.create({
        data: { userId },
      });
      return {
        id: created.id,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.clientProfile.findUniqueOrThrow({
          where: { userId },
        });
        return {
          id: again.id,
          createdAt: again.createdAt.toISOString(),
          updatedAt: again.updatedAt.toISOString(),
        };
      }
      throw error;
    }
  }

  async getJobberMe(userId: string) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    return this.serializeJobberProfile(profile);
  }

  async updateJobberMe(
    userId: string,
    input: { bio?: string; headline?: string; yearsOfExperience?: number },
  ) {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    const updated = await this.prisma.jobberProfile.update({
      where: { userId },
      data: {
        bio: input.bio === undefined ? undefined : input.bio.trim() || null,
        headline:
          input.headline === undefined
            ? undefined
            : input.headline.trim() || null,
        yearsOfExperience: input.yearsOfExperience,
      },
    });
    return this.serializeJobberProfile(updated);
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
