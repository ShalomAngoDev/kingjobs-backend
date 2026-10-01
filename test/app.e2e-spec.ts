import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

describe('API e2e (Backend 01)', () => {
  let app: INestApplication;

  const ping = jest.fn().mockResolvedValue(true);

  const prismaMock: Partial<PrismaService> = {
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    onModuleDestroy: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
    ping,
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3001';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@127.0.0.1:5432/kingjobs_test?schema=public';
    process.env.DIRECT_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
    process.env.API_PREFIX = 'api';
    process.env.API_VERSION = '1';
    process.env.SERVICE_NAME = 'kingjobs-api';
    process.env.CORS_ORIGINS = 'http://localhost:3000';
    process.env.SWAGGER_ENABLED = 'false';
    process.env.THROTTLE_TTL_MS = '60000';
    process.env.THROTTLE_LIMIT = '100';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new RequestIdInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1 returns API metadata', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .expect(200);

    expect(response.body).toMatchObject({
      name: 'KingJOBS API',
      version: 'v1',
      service: 'kingjobs-api',
    });
  });

  it('GET /api/v1/health/live returns liveness', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('GET /api/v1/health returns database up when ping succeeds', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      database: 'up',
      service: 'kingjobs-api',
    });
  });

  it('GET /api/v1/health returns 503 when database is down', async () => {
    ping.mockRejectedValueOnce(new Error('down'));

    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(response.body.database).toBe('down');
    expect(response.body.status).toBe('degraded');
  });
});
