import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  MOCK_PAYMENT_PROVIDER,
  type ConfirmPaymentInput,
  type InitializePaymentInput,
  type InitializePaymentResult,
  type PaymentProvider,
} from './payment.types';

/**
 * Provider DEV uniquement — aucun débit, aucun agrégateur externe.
 * Logs préfixés MOCK PAYMENT pour distinction nette vs paiements réels futurs.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly id = MOCK_PAYMENT_PROVIDER;
  private readonly logger = new Logger(MockPaymentProvider.name);

  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const providerReference = `MOCK:${input.missionId}:${randomUUID()}`;
    this.logger.log(
      `MOCK PAYMENT initialize mission=${input.missionId} amount=${input.amount} ${input.currency} ref=${providerReference}`,
    );
    return Promise.resolve({
      provider: this.id,
      providerReference,
      status: PaymentStatus.PENDING,
      amount: input.amount,
      currency: input.currency,
    });
  }

  verifyConfirmation(input: ConfirmPaymentInput): Promise<boolean> {
    const ok = input.providerReference.startsWith('MOCK:');
    this.logger.log(
      `MOCK PAYMENT verify mission=${input.missionId} ref=${input.providerReference} ok=${ok}`,
    );
    return Promise.resolve(ok);
  }
}
