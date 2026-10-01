import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { buildCorsOptions } from './common/utils/cors';
import type { AppConfig, AuthConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');
  const authConfig = configService.getOrThrow<AuthConfig>('auth');
  const logger = new Logger('Bootstrap');

  app.set('trust proxy', appConfig.trustProxy);
  app.enableShutdownHooks();

  app.use(
    helmet({
      contentSecurityPolicy: appConfig.swaggerEnabled ? false : undefined,
    }),
  );

  app.useBodyParser('json', { limit: appConfig.bodyLimit });

  app.enableCors(
    buildCorsOptions(appConfig.corsOrigins, appConfig.corsOriginRegexes),
  );

  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (appConfig.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('KingJOBS API')
        .setDescription('API centrale KingJOBS (modular monolith)')
        .setVersion(appConfig.appVersion)
        .addBearerAuth()
        .addServer(`/${appConfig.apiPrefix}`)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  const port = Number(process.env.PORT ?? appConfig.port);
  await app.listen(port);

  logger.log(`environment=${appConfig.nodeEnv}`);
  logger.log(`port=${port}`);
  logger.log(`api=/${appConfig.apiPrefix}/v${appConfig.apiVersion}`);
  logger.log(`swagger=${appConfig.swaggerEnabled ? 'enabled' : 'disabled'}`);
  logger.log(`cors_origins=${appConfig.corsOrigins.length}`);
  logger.log(`cors_regexes=${appConfig.corsOriginRegexes.length}`);
  logger.log(`app_web_url=${authConfig.appWebUrl}`);
}

void bootstrap();
