import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AvailableMissionsQueryDto,
  MyMissionsQueryDto,
} from './dto/mission-queries.dto';
import { MissionApplicationsService } from './mission-applications.service';
import { MissionsService } from './missions.service';

/**
 * Routes statiques Jobber. Ce contrôleur DOIT être enregistré avant MissionsController
 * (voir missions.module.ts) pour que `available` ne soit pas capté par `GET :id`.
 */
@ApiTags('missions-jobber')
@ApiBearerAuth()
@Controller({ path: 'missions', version: '1' })
export class JobberMissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly applications: MissionApplicationsService,
  ) {}

  @Get('available')
  @ApiOperation({
    summary: 'Missions publiées candidatables (sans adresse précise)',
  })
  available(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AvailableMissionsQueryDto,
  ) {
    return this.missionsService.listAvailable(user.id, query);
  }

  @Get('me/jobber')
  @ApiOperation({ summary: 'Mes missions en tant que Jobber affecté' })
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyMissionsQueryDto,
  ) {
    return this.missionsService.listMineAsJobber(user.id, query);
  }

  @Get('me/jobber/applications')
  @ApiOperation({ summary: 'Mes candidatures Jobber' })
  myApplications(@CurrentUser() user: AuthenticatedUser) {
    return this.applications.listMine(user.id);
  }
}
