import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from '../src/config/configuration';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { PrismaModule } from '../src/infrastructure/prisma/prisma.module';
import { HealthModule } from '../src/modules/health/health.module';
import { MetaModule } from '../src/modules/meta/meta.module';

/**
 * Module e2e minimal (sans auth/passport) pour health + meta.
 * Les tests auth unitaires couvrent le socle identité.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      ignoreEnvFile: true,
    }),
    PrismaModule,
    HealthModule,
    MetaModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    ConfigService,
  ],
})
export class E2eAppModule {}
