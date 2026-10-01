import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  AdminIncidentsQueryDto,
  AdminMissionsQueryDto,
} from './dto/mission-queries.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionsService } from './missions.service';

@ApiTags('admin-missions')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminMissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly incidentsService: MissionIncidentsService,
  ) {}

  @Get('missions')
  @ApiOperation({ summary: 'Lister les missions (filtres + pagination)' })
  list(@Query() query: AdminMissionsQueryDto) {
    return this.missionsService.adminList(query);
  }

  @Get('missions/:id')
  @ApiOperation({ summary: 'Détail mission (adresse complète, incidents)' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.missionsService.adminDetail(id);
  }

  @Get('missions/:id/history')
  @ApiOperation({ summary: 'Historique des statuts' })
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.missionsService.adminHistory(id);
  }

  @Get('incidents')
  @ApiOperation({ summary: 'Lister les incidents' })
  incidents(@Query() query: AdminIncidentsQueryDto) {
    return this.incidentsService.adminList(query);
  }

  @Patch('incidents/:id/status')
  @ApiOperation({ summary: 'Changer le statut d’un incident' })
  updateIncidentStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateIncidentStatusDto,
  ) {
    return this.incidentsService.adminUpdateStatus(id, dto.status);
  }
}
