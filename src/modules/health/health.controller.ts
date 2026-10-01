import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Healthcheck général (process + database)' })
  @ApiOkResponse({ description: 'Service et base de données opérationnels' })
  check() {
    return this.healthService.check();
  }

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness — le processus répond' })
  live() {
    return this.healthService.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness — dépendances critiques (DB)' })
  ready() {
    return this.healthService.ready();
  }
}
