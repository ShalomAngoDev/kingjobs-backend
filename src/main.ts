import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');
  const logger = new Logger('Bootstrap');

  app.set('trust proxy', appConfig.trustProxy);
  app.enableShutdownHooks();

  app.use(
    helmet({
      // Allow Swagger UI assets when enabled
      contentSecurityPolicy: appConfig.swaggerEnabled ? false : undefined,
    }),
  );

  app.useBodyParser('json', { limit: appConfig.bodyLimit });

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

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
        .addServer(`/${appConfig.apiPrefix}`)
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
    });
  }

  await app.listen(appConfig.port);

  logger.log(`environment=${appConfig.nodeEnv}`);
  logger.log(`port=${appConfig.port}`);
  logger.log(`api=/${appConfig.apiPrefix}/v${appConfig.apiVersion}`);
  logger.log(`swagger=${appConfig.swaggerEnabled ? 'enabled' : 'disabled'}`);
  logger.log(`cors_origins=${appConfig.corsOrigins.length}`);
}

void bootstrap();
