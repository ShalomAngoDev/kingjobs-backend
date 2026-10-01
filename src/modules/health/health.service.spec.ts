import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

describe('HealthService', () => {
  const appConfig = {
    serviceName: 'kingjobs-api',
    appVersion: '0.1.0',
  };

  const configService = {
    getOrThrow: jest.fn().mockReturnValue(appConfig),
  } as unknown as ConfigService;

  it('returns ok when database ping succeeds', async () => {
    const ping = jest.fn().mockResolvedValue(true);
    const prisma = { ping } as unknown as PrismaService;

    const service = new HealthService(prisma, configService);
    const result = await service.check();

    expect(result.status).toBe('ok');
    expect(result.database).toBe('up');
    expect(result.service).toBe('kingjobs-api');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('throws 503 when database ping fails', async () => {
    const ping = jest.fn().mockRejectedValue(new Error('connection refused'));
    const prisma = { ping } as unknown as PrismaService;

    const service = new HealthService(prisma, configService);

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('live does not touch the database', () => {
    const ping = jest.fn();
    const prisma = { ping } as unknown as PrismaService;

    const service = new HealthService(prisma, configService);
    const result = service.live();

    expect(result.status).toBe('ok');
    expect(ping).not.toHaveBeenCalled();
  });
});
