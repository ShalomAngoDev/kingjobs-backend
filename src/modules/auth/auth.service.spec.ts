import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobberStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { SessionsService } from './sessions.service';
import { TokensService } from './tokens.service';

jest.mock('../../common/utils/password', () => ({
  validatePasswordPolicy: jest.fn(),
  hashPassword: jest.fn().mockResolvedValue('hashed'),
  verifyPassword: jest.fn(),
}));

describe('AuthService', () => {
  const authConfig = {
    jwtAccessSecret: 'x'.repeat(32),
    jwtAccessTtl: '15m',
    refreshTokenTtlDays: 30,
    emailVerifyTtlHours: 24,
    passwordResetTtlMinutes: 30,
    otpTtlMinutes: 5,
    otpMaxAttempts: 5,
    appWebUrl: 'http://localhost:3000',
    defaultPhoneRegion: 'BJ',
    resendApiKey: null,
    emailFrom: 'test@example.com',
    smsProvider: 'console' as const,
  };

  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    jobberProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  } as unknown as PrismaService;

  const sessionsService = {} as SessionsService;
  const tokensService = {
    createEmailVerificationToken: jest.fn(),
  } as unknown as TokensService;
  const emailService = { send: jest.fn() } as unknown as EmailService;
  const smsService = { send: jest.fn() } as unknown as SmsService;
  const configService = {
    getOrThrow: jest.fn().mockReturnValue(authConfig),
  } as unknown as ConfigService;

  const service = new AuthService(
    prisma,
    sessionsService,
    tokensService,
    emailService,
    smsService,
    configService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects registration under 16', async () => {
    await expect(
      service.register({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        phone: '+22990123456',
        dateOfBirth: '2015-10-01',
        password: 'password123',
        acceptTerms: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('login returns generic error when user missing', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.login({ email: 'missing@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('activateJobber is idempotent for same user', async () => {
    (prisma.jobberProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'jp1',
      userId: 'u1',
      status: JobberStatus.DRAFT,
      headline: null,
      bio: null,
      yearsOfExperience: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const first = await service.activateJobber('u1');
    const second = await service.activateJobber('u1');
    expect(first.id).toBe(second.id);
    expect(prisma.jobberProfile.create).not.toHaveBeenCalled();
  });

  it('forgotPassword does not reveal account existence', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await service.forgotPassword({
      email: 'unknown@example.com',
    });
    expect(result.message).toMatch(/Si un compte existe/);
  });
});
