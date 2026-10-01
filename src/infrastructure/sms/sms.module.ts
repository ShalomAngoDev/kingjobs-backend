import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, AuthConfig } from '../../config/configuration';
import { ConsoleSmsProvider } from './console-sms.provider';
import { SmsService } from './sms.service';
import { SMS_PROVIDER } from './sms.types';
import { UnavailableSmsProvider } from './unavailable-sms.provider';

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const app = configService.getOrThrow<AppConfig>('app');
        const auth = configService.getOrThrow<AuthConfig>('auth');

        if (auth.smsProvider === 'console') {
          return new ConsoleSmsProvider(app.nodeEnv);
        }

        // production (ou SMS_PROVIDER=none) : échec explicite à l'envoi
        return new UnavailableSmsProvider();
      },
    },
    SmsService,
  ],
  exports: [SmsService],
})
export class SmsModule {}
