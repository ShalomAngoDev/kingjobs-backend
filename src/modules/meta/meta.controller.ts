import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import type { AppConfig } from '../../config/configuration';

@ApiTags('meta')
@Public()
@SkipThrottle()
@Controller({ path: '', version: '1' })
export class MetaController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Métadonnées de l’API v1' })
  @ApiOkResponse({ description: 'Identité de l’API' })
  root() {
    const app = this.configService.getOrThrow<AppConfig>('app');
    return {
      name: 'KingJOBS API',
      version: `v${app.apiVersion}`,
      service: app.serviceName,
      appVersion: app.appVersion,
    };
  }
}
