import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobberStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SmsService } from '../../infrastructure/sms/sms.service';
import { SessionsService } from './sessions.service';
import { TokensService } from './tokens.service';
import { normalizePhoneToE164 } from '../../common/utils/phone';
import { verifyPassword } from '../../common/utils/password';

jest.mock('../../common/utils/password', () => ({
  validatePasswordPolicy: jest.fn(),
  hashPassword: jest.fn().mockResolvedValue('hashed'),
  verifyPassword: jest.fn(),
}));

jest.mock('../../common/utils/phone', () => ({
  normalizePhoneToE164: jest.fn((v: string) =>
    v.startsWith('+') ? v : `+229${v.replace(/\D/g, '').slice(-8)}`,
  ),
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
    user: { findUnique: jest.fn(), create: jest.fn() },
    jobberProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    clientProfile: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    termsAcceptance: { create: jest.fn() },
  } as unknown as PrismaService;

  const sessionsService = {
    issueTokensForUser: jest.fn().mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
      tokenType: 'Bearer',
      expiresIn: '15m',
      user: { id: 'u1' },
    }),
  } as unknown as SessionsService;
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

  it('rejects registration under 16 when DOB is provided', async () => {
    await expect(
      service.register({
        firstName: 'A',
        lastName: 'B',
        countryCode: 'BJ',
        email: 'a@example.com',
        phone: '+22990123456',
        dateOfBirth: '2015-10-01',
        password: 'password12345',
        acceptTerms: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects registration without accepting terms', async () => {
    await expect(
      service.register({
        firstName: 'A',
        lastName: 'B',
        countryCode: 'BJ',
        phone: '+22990123456',
        password: 'password12345',
        acceptTerms: false as unknown as true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('registers without email and without DOB', async () => {
    const created = {
      id: 'u1',
      firstName: 'Aïcha',
      lastName: 'Koffi',
      email: null,
      phone: '+22990123456',
      countryCode: 'BJ',
      dateOfBirth: null,
      createdAt: new Date(),
    };
    (prisma.$transaction as jest.Mock).mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    (prisma.user.create as jest.Mock).mockResolvedValue(created);
    (prisma.termsAcceptance.create as jest.Mock).mockResolvedValue({});

    await service.register({
      firstName: 'Aïcha',
      lastName: 'Koffi',
      countryCode: 'BJ',
      phone: '90 12 34 56',
      password: 'password12345',
      acceptTerms: true,
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: null,
          emailNormalized: null,
          dateOfBirth: null,
          countryCode: 'BJ',
          phone: expect.stringMatching(/^\+229/),
        }),
      }),
    );
    expect(tokensService.createEmailVerificationToken).not.toHaveBeenCalled();
    expect(sessionsService.issueTokensForUser).toHaveBeenCalled();
  });

  it('login phone returns generic error when user missing', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.login({
        phone: '+22990123456',
        countryCode: 'BJ',
        password: 'password12345',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login email still works for admin path', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(
      service.login({ email: 'missing@example.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login phone succeeds with valid password', async () => {
    (normalizePhoneToE164 as jest.Mock).mockReturnValue('+22990123456');
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: 'u1',
      phone: '+22990123456',
      countryCode: 'BJ',
      passwordHash: 'hashed',
      status: 'ACTIVE',
      jobberProfile: null,
      clientProfile: null,
    });
    (verifyPassword as jest.Mock).mockResolvedValue(true);

    await service.login({
      phone: '90123456',
      countryCode: 'BJ',
      password: 'password12345',
    });
    expect(sessionsService.issueTokensForUser).toHaveBeenCalled();
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

  it('activateClient creates profile once', async () => {
    (prisma.clientProfile.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'cp1',
        userId: 'u1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    (prisma.clientProfile.create as jest.Mock).mockResolvedValue({
      id: 'cp1',
      userId: 'u1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const first = await service.activateClient('u1');
    expect(first.id).toBe('cp1');
    expect(prisma.clientProfile.create).toHaveBeenCalledTimes(1);

    (prisma.clientProfile.findUnique as jest.Mock).mockResolvedValue({
      id: 'cp1',
      userId: 'u1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const second = await service.activateClient('u1');
    expect(second.id).toBe('cp1');
    expect(prisma.clientProfile.create).toHaveBeenCalledTimes(1);
  });

  it('forgotPassword does not reveal account existence', async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await service.forgotPassword({
      email: 'unknown@example.com',
    });
    expect(result.message).toMatch(/Si un compte existe/);
  });
});
