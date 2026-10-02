import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, PaymentConfig } from '../../config/configuration';
import { MockPaymentProvider } from './mock-payment.provider';
import {
  PAYMENT_PROVIDER_TOKEN,
  PaymentConfigurationError,
  type PaymentProvider,
} from './payment.types';

/**
 * Provider null : fail-closed lorsque PAYMENT_PROVIDER n'est pas `mock`.
 * Les endpoints de simulation refusent ; aucun auto-fallback.
 */
class DisabledPaymentProvider implements PaymentProvider {
  readonly id = 'NONE';

  async initialize(): Promise<never> {
    throw new PaymentConfigurationError(
      'Aucun fournisseur de paiement actif (PAYMENT_PROVIDER ≠ mock).',
    );
  }

  async verifyConfirmation(): Promise<boolean> {
    return false;
  }
}

@Module({
  providers: [
    MockPaymentProvider,
    {
      provide: PAYMENT_PROVIDER_TOKEN,
      inject: [ConfigService, MockPaymentProvider],
      useFactory: (
        configService: ConfigService,
        mock: MockPaymentProvider,
      ): PaymentProvider => {
        const app = configService.getOrThrow<AppConfig>('app');
        const payment = configService.getOrThrow<PaymentConfig>('payment');

        if (payment.provider === 'mock') {
          if (app.nodeEnv === 'production') {
            throw new PaymentConfigurationError(
              'PAYMENT_PROVIDER=mock est interdit en production.',
            );
          }
          return mock;
        }

        return new DisabledPaymentProvider();
      },
    },
  ],
  exports: [PAYMENT_PROVIDER_TOKEN],
})
export class PaymentInfrastructureModule {}
