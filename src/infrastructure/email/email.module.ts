import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, AuthConfig } from '../../config/configuration';
import { ConsoleEmailProvider } from './console-email.provider';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './email.types';
import { ResendEmailProvider } from './resend-email.provider';

@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const app = configService.getOrThrow<AppConfig>('app');
        const auth = configService.getOrThrow<AuthConfig>('auth');

        if (auth.resendApiKey) {
          return new ResendEmailProvider(auth.resendApiKey, auth.emailFrom);
        }

        return new ConsoleEmailProvider(app.nodeEnv);
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
