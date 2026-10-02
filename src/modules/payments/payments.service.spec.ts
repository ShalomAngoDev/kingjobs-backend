import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MissionStatus, PaymentStatus } from '@prisma/client';
import { MockPaymentProvider } from '../../infrastructure/payments/mock-payment.provider';
import { MOCK_PAYMENT_PROVIDER } from '../../infrastructure/payments/payment.types';
import { PaymentsService } from './payments.service';

describe('PaymentsService mock simulation', () => {
  const missionId = '11111111-1111-1111-1111-111111111111';
  const userId = '22222222-2222-2222-2222-222222222222';

  function buildService(opts: {
    simulationEnabled?: boolean;
    missionStatus?: MissionStatus;
    paymentConfirmedAt?: Date | null;
    providerId?: string;
  }) {
    const mission = {
      id: missionId,
      clientUserId: userId,
      status: opts.missionStatus ?? MissionStatus.PAYMENT_REQUIRED,
      paymentConfirmedAt: opts.paymentConfirmedAt ?? null,
      pricingType: 'FIXED',
      rateAmount: 20_000,
      rateScope: 'PER_JOBBER',
      clientPriceAmount: 20_000,
      estimatedAmount: 20_000,
      workersNeeded: 1,
      estimatedDurationMinutes: 120,
      durationKnown: true,
      schedulingType: 'ONCE',
      currency: 'XOF',
    };

    const prisma = {
      mission: {
        findUnique: jest.fn().mockResolvedValue(mission),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...mission,
          status: MissionStatus.PENDING_REVIEW,
          paymentConfirmedAt: new Date(),
        }),
      },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          ...data,
          createdAt: new Date(),
          confirmedAt: data.confirmedAt ?? null,
          failedAt: data.failedAt ?? null,
          cancelledAt: data.cancelledAt ?? null,
        })),
      },
    };

    const missionsService = {
      markPaymentConfirmed: jest.fn().mockResolvedValue({
        id: missionId,
        status: MissionStatus.PENDING_REVIEW,
        paymentConfirmedAt: new Date(),
      }),
    };

    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'app') {
          return { nodeEnv: 'development' };
        }
        if (key === 'payment') {
          return {
            provider: opts.simulationEnabled === false ? 'none' : 'mock',
          };
        }
        throw new Error(`unknown config ${key}`);
      }),
    } as unknown as ConfigService;

    const provider =
      opts.providerId === 'NONE'
        ? {
            id: 'NONE',
            initialize: jest.fn(),
            verifyConfirmation: jest.fn(),
          }
        : new MockPaymentProvider();

    const service = new PaymentsService(
      prisma as never,
      missionsService as never,
      configService,
      provider as never,
    );

    return { service, prisma, missionsService, mission };
  }

  it('refuse la simulation si PAYMENT_PROVIDER ≠ mock', async () => {
    const { service } = buildService({ simulationEnabled: false });
    await expect(service.simulateSuccess(userId, missionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('succès : crée Payment CONFIRMED et appelle markPaymentConfirmed', async () => {
    const { service, prisma, missionsService } = buildService({});
    const result = await service.simulateSuccess(userId, missionId);
    expect(result.outcome).toBe('confirmed');
    expect(result.missionStatus).toBe(MissionStatus.PENDING_REVIEW);
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: MOCK_PAYMENT_PROVIDER,
          status: PaymentStatus.CONFIRMED,
          amount: 20_000,
        }),
      }),
    );
    expect(missionsService.markPaymentConfirmed).toHaveBeenCalledWith(
      missionId,
      userId,
    );
  });

  it('succès idempotent si déjà payé', async () => {
    const { service, missionsService, prisma } = buildService({
      missionStatus: MissionStatus.PENDING_REVIEW,
      paymentConfirmedAt: new Date(),
    });
    prisma.payment.findFirst.mockResolvedValue({
      id: 'pay-1',
      amount: 20_000,
      currency: 'XOF',
      provider: MOCK_PAYMENT_PROVIDER,
      providerReference: 'MOCK:x',
      status: PaymentStatus.CONFIRMED,
      confirmedAt: new Date(),
      failedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
    });
    const result = await service.simulateSuccess(userId, missionId);
    expect(result.outcome).toBe('already_confirmed');
    expect(missionsService.markPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('échec : Mission reste PAYMENT_REQUIRED', async () => {
    const { service, missionsService } = buildService({});
    const result = await service.simulateFailure(userId, missionId);
    expect(result.outcome).toBe('failed');
    expect(result.missionStatus).toBe(MissionStatus.PAYMENT_REQUIRED);
    expect(missionsService.markPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('annulation : Mission reste PAYMENT_REQUIRED', async () => {
    const { service, missionsService } = buildService({});
    const result = await service.simulateCancel(userId, missionId);
    expect(result.outcome).toBe('cancelled');
    expect(result.missionStatus).toBe(MissionStatus.PAYMENT_REQUIRED);
    expect(missionsService.markPaymentConfirmed).not.toHaveBeenCalled();
  });

  it('refuse ownership Client B', async () => {
    const { service, prisma } = buildService({});
    prisma.mission.findUnique.mockResolvedValue({
      id: missionId,
      clientUserId: 'other-user',
      status: MissionStatus.PAYMENT_REQUIRED,
      paymentConfirmedAt: null,
      pricingType: 'FIXED',
      rateAmount: 20_000,
      rateScope: 'PER_JOBBER',
      clientPriceAmount: 20_000,
      estimatedAmount: 20_000,
      workersNeeded: 1,
      estimatedDurationMinutes: 120,
      durationKnown: true,
      schedulingType: 'ONCE',
      currency: 'XOF',
    });
    await expect(service.simulateSuccess(userId, missionId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse succès hors PAYMENT_REQUIRED', async () => {
    const { service } = buildService({
      missionStatus: MissionStatus.DRAFT,
    });
    await expect(service.simulateSuccess(userId, missionId)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
