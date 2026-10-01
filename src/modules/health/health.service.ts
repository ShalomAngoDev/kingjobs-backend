import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type HealthResponse = {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  database: 'up' | 'down';
  version: string;
};

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private get app(): AppConfig {
    return this.configService.getOrThrow<AppConfig>('app');
  }

  async check(): Promise<HealthResponse> {
    const database = await this.checkDatabase();
    const status = database === 'up' ? 'ok' : 'degraded';

    const payload: HealthResponse = {
      status,
      service: this.app.serviceName,
      timestamp: new Date().toISOString(),
      database,
      version: this.app.appVersion,
    };

    if (database === 'down') {
      throw new ServiceUnavailableException(payload);
    }

    return payload;
  }

  live() {
    return {
      status: 'ok' as const,
      service: this.app.serviceName,
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthResponse> {
    return this.check();
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.prisma.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }
}
