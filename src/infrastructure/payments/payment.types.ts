import type { PaymentStatus } from '@prisma/client';

export const PAYMENT_PROVIDER_TOKEN = Symbol('PAYMENT_PROVIDER');

export const MOCK_PAYMENT_PROVIDER = 'MOCK';

export type PaymentProviderId = 'mock' | 'none';

export type PaymentAmount = {
  amount: number;
  currency: string;
};

export type InitializePaymentInput = {
  missionId: string;
  userId: string;
  amount: number;
  currency: string;
};

export type InitializePaymentResult = {
  provider: string;
  providerReference: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
};

export type ConfirmPaymentInput = {
  missionId: string;
  userId: string;
  providerReference: string;
};

export type PaymentProvider = {
  readonly id: string;
  initialize(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  /** Vérifie une confirmation côté provider (mock : confiance contrôlée DEV). */
  verifyConfirmation(input: ConfirmPaymentInput): Promise<boolean>;
};

export class PaymentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentConfigurationError';
  }
}
