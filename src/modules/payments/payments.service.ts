import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MissionStatus, PaymentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AppConfig, PaymentConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  MOCK_PAYMENT_PROVIDER,
  PAYMENT_PROVIDER_TOKEN,
  type PaymentProvider,
} from '../../infrastructure/payments/payment.types';
import { derivePricingFromMission } from '../missions/mission-pricing';
import { MissionsService } from '../missions/missions.service';

export type MissionPaymentView = {
  missionId: string;
  status: string;
  amount: number;
  currency: string;
  workersNeeded: number;
  workerGrossAmount: number;
  estimatedTotalAmount: number;
  simulationEnabled: boolean;
  paymentProvider: string | null;
  paymentConfirmedAt: string | null;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MissionsService))
    private readonly missionsService: MissionsService,
    private readonly configService: ConfigService,
    @Inject(PAYMENT_PROVIDER_TOKEN)
    private readonly paymentProvider: PaymentProvider,
  ) {}

  isSimulationEnabled(): boolean {
    const app = this.configService.getOrThrow<AppConfig>('app');
    const payment = this.configService.getOrThrow<PaymentConfig>('payment');
    return payment.provider === 'mock' && app.nodeEnv !== 'production';
  }

  async getMissionPaymentView(
    userId: string,
    missionId: string,
  ): Promise<MissionPaymentView> {
    const mission = await this.requireOwnedMission(userId, missionId);
    const amounts = this.resolveAmount(mission);
    return {
      missionId: mission.id,
      status: mission.status,
      amount: amounts.amount,
      currency: mission.currency,
      workersNeeded: mission.workersNeeded,
      workerGrossAmount: amounts.workerGrossAmount,
      estimatedTotalAmount: amounts.estimatedTotalAmount,
      simulationEnabled: this.isSimulationEnabled(),
      paymentProvider: this.isSimulationEnabled()
        ? MOCK_PAYMENT_PROVIDER
        : null,
      paymentConfirmedAt: mission.paymentConfirmedAt?.toISOString() ?? null,
    };
  }

  async simulateSuccess(userId: string, missionId: string) {
    this.assertSimulationAllowed();
    const mission = await this.requireOwnedMission(userId, missionId);

    if (
      mission.paymentConfirmedAt &&
      (mission.status === MissionStatus.PENDING_REVIEW ||
        mission.status === MissionStatus.NEEDS_CHANGES ||
        mission.status === MissionStatus.PUBLISHED ||
        mission.status === MissionStatus.REJECTED)
    ) {
      const existing = await this.findConfirmedPayment(missionId);
      this.logger.log(
        `MOCK PAYMENT success idempotent mission=${missionId} status=${mission.status}`,
      );
      return this.serializeOutcome(mission, existing, 'already_confirmed');
    }

    if (mission.status !== MissionStatus.PAYMENT_REQUIRED) {
      throw new ConflictException(
        'La simulation de succès n’est possible qu’en PAYMENT_REQUIRED.',
      );
    }

    const amounts = this.resolveAmount(mission);
    const init = await this.paymentProvider.initialize({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
    });

    const verified = await this.paymentProvider.verifyConfirmation({
      missionId,
      userId,
      providerReference: init.providerReference,
    });
    if (!verified) {
      throw new BadRequestException('Vérification mock du paiement échouée.');
    }

    const confirmedAt = new Date();
    const payment = await this.createPaymentRecord({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
      providerReference: init.providerReference,
      status: PaymentStatus.CONFIRMED,
      confirmedAt,
    });

    const updated = await this.missionsService.markPaymentConfirmed(
      missionId,
      userId,
    );

    this.logger.log(
      `MOCK PAYMENT confirmed mission=${missionId} amount=${amounts.amount} ${mission.currency} → ${updated.status}`,
    );

    return this.serializeOutcome(updated, payment, 'confirmed');
  }

  async simulateFailure(userId: string, missionId: string) {
    this.assertSimulationAllowed();
    const mission = await this.requireOwnedMission(userId, missionId);
    if (mission.status !== MissionStatus.PAYMENT_REQUIRED) {
      throw new ConflictException(
        'La simulation d’échec n’est possible qu’en PAYMENT_REQUIRED.',
      );
    }

    const amounts = this.resolveAmount(mission);
    const init = await this.paymentProvider.initialize({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
    });

    const payment = await this.createPaymentRecord({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
      providerReference: init.providerReference,
      status: PaymentStatus.FAILED,
      failedAt: new Date(),
    });

    this.logger.log(
      `MOCK PAYMENT failed mission=${missionId} ref=${init.providerReference}`,
    );

    return {
      outcome: 'failed' as const,
      message: "Le paiement n'a pas abouti.",
      missionStatus: MissionStatus.PAYMENT_REQUIRED,
      payment: payment ? this.serializePayment(payment) : null,
    };
  }

  async simulateCancel(userId: string, missionId: string) {
    this.assertSimulationAllowed();
    const mission = await this.requireOwnedMission(userId, missionId);
    if (mission.status !== MissionStatus.PAYMENT_REQUIRED) {
      throw new ConflictException(
        'La simulation d’annulation n’est possible qu’en PAYMENT_REQUIRED.',
      );
    }

    const amounts = this.resolveAmount(mission);
    const init = await this.paymentProvider.initialize({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
    });

    const payment = await this.createPaymentRecord({
      missionId,
      userId,
      amount: amounts.amount,
      currency: mission.currency,
      providerReference: init.providerReference,
      status: PaymentStatus.CANCELLED,
      cancelledAt: new Date(),
    });

    this.logger.log(
      `MOCK PAYMENT cancelled mission=${missionId} ref=${init.providerReference}`,
    );

    return {
      outcome: 'cancelled' as const,
      message: 'Paiement annulé. Vous pourrez réessayer plus tard.',
      missionStatus: MissionStatus.PAYMENT_REQUIRED,
      payment: payment ? this.serializePayment(payment) : null,
    };
  }

  private assertSimulationAllowed() {
    if (!this.isSimulationEnabled()) {
      throw new ForbiddenException(
        'Simulateur de paiement désactivé (PAYMENT_PROVIDER ≠ mock).',
      );
    }
    if (this.paymentProvider.id !== MOCK_PAYMENT_PROVIDER) {
      throw new ForbiddenException(
        'Le fournisseur actif n’autorise pas la simulation.',
      );
    }
  }

  private async requireOwnedMission(userId: string, missionId: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
    });
    if (!mission) {
      throw new NotFoundException('Mission introuvable');
    }
    if (mission.clientUserId !== userId) {
      throw new ForbiddenException('Cette mission ne vous appartient pas.');
    }
    return mission;
  }

  private resolveAmount(mission: {
    pricingType: string;
    rateAmount: number | null;
    rateScope: string;
    clientPriceAmount: number;
    estimatedAmount: number | null;
    workersNeeded: number;
    estimatedDurationMinutes: number | null;
    durationKnown: boolean;
    schedulingType: string;
    currency: string;
  }) {
    try {
      const computed = derivePricingFromMission({
        pricingType: mission.pricingType as never,
        rateAmount: mission.rateAmount,
        rateScope: mission.rateScope as never,
        clientPriceAmount: mission.clientPriceAmount,
        estimatedAmount: mission.estimatedAmount,
        workersNeeded: mission.workersNeeded,
        estimatedDurationMinutes: mission.estimatedDurationMinutes,
        durationKnown: mission.durationKnown,
        schedulingType: mission.schedulingType as never,
      });
      return {
        amount: computed.estimatedTotalAmount,
        workerGrossAmount: computed.workerGrossAmount,
        estimatedTotalAmount: computed.estimatedTotalAmount,
      };
    } catch {
      return {
        amount: mission.estimatedAmount ?? mission.clientPriceAmount,
        workerGrossAmount: mission.clientPriceAmount,
        estimatedTotalAmount:
          mission.estimatedAmount ?? mission.clientPriceAmount,
      };
    }
  }

  private async findConfirmedPayment(missionId: string) {
    try {
      return await this.prisma.payment.findFirst({
        where: {
          missionId,
          provider: MOCK_PAYMENT_PROVIDER,
          status: PaymentStatus.CONFIRMED,
        },
        orderBy: { confirmedAt: 'desc' },
      });
    } catch (error) {
      this.logger.warn(
        `MOCK PAYMENT table payments indisponible mission=${missionId}: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
      return null;
    }
  }

  private async createPaymentRecord(input: {
    missionId: string;
    userId: string;
    amount: number;
    currency: string;
    providerReference: string;
    status: PaymentStatus;
    confirmedAt?: Date;
    failedAt?: Date;
    cancelledAt?: Date;
  }) {
    try {
      return await this.prisma.payment.create({
        data: {
          id: randomUUID(),
          missionId: input.missionId,
          userId: input.userId,
          amount: input.amount,
          currency: input.currency,
          provider: MOCK_PAYMENT_PROVIDER,
          providerReference: input.providerReference,
          status: input.status,
          confirmedAt: input.confirmedAt ?? null,
          failedAt: input.failedAt ?? null,
          cancelledAt: input.cancelledAt ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.findConfirmedPayment(input.missionId);
      }
      this.logger.warn(
        `MOCK PAYMENT persist skipped mission=${input.missionId}: ${
          error instanceof Error ? error.message : 'error'
        }. Appliquez: docker compose exec api npx prisma migrate deploy`,
      );
      return {
        id: randomUUID(),
        amount: input.amount,
        currency: input.currency,
        provider: MOCK_PAYMENT_PROVIDER,
        providerReference: input.providerReference,
        status: input.status,
        confirmedAt: input.confirmedAt ?? null,
        failedAt: input.failedAt ?? null,
        cancelledAt: input.cancelledAt ?? null,
        createdAt: new Date(),
      };
    }
  }

  private serializePayment(payment: {
    id: string;
    amount: number;
    currency: string;
    provider: string;
    providerReference: string;
    status: PaymentStatus;
    confirmedAt: Date | null;
    failedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      provider: payment.provider,
      providerReference: payment.providerReference,
      status: payment.status,
      isTestPayment: payment.provider === MOCK_PAYMENT_PROVIDER,
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      failedAt: payment.failedAt?.toISOString() ?? null,
      cancelledAt: payment.cancelledAt?.toISOString() ?? null,
      createdAt: payment.createdAt.toISOString(),
    };
  }

  private serializeOutcome(
    mission: {
      id: string;
      status: MissionStatus;
      paymentConfirmedAt: Date | null;
    },
    payment:
      | {
          id: string;
          amount: number;
          currency: string;
          provider: string;
          providerReference: string;
          status: PaymentStatus;
          confirmedAt: Date | null;
          failedAt: Date | null;
          cancelledAt: Date | null;
          createdAt: Date;
        }
      | null
      | undefined,
    outcome: 'confirmed' | 'already_confirmed',
  ) {
    return {
      outcome,
      message:
        outcome === 'already_confirmed'
          ? 'Paiement test déjà validé.'
          : 'Paiement test validé',
      missionStatus: mission.status,
      paymentConfirmedAt: mission.paymentConfirmedAt?.toISOString() ?? null,
      payment: payment ? this.serializePayment(payment) : null,
    };
  }
}
