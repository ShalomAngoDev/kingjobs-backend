import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AdminIncidentsQueryDto,
  AdminMissionsQueryDto,
} from './dto/mission-queries.dto';
import {
  ApproveMissionDto,
  RejectMissionDto,
  RequestMissionChangesDto,
} from './dto/mission-review.dto';
import { UpdateIncidentStatusDto } from './dto/update-incident-status.dto';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionReviewService } from './mission-review.service';
import { MissionsService } from './missions.service';

@ApiTags('admin-missions')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminMissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly incidentsService: MissionIncidentsService,
    private readonly reviewService: MissionReviewService,
  ) {}

  @Get('missions/counts')
  @ApiOperation({ summary: 'Compteurs missions (file revue)' })
  counts() {
    return this.reviewService.counts();
  }

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

  @Post('missions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valider et publier (PENDING_REVIEW → PUBLISHED)' })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveMissionDto,
  ) {
    return this.reviewService.approve({
      missionId: id,
      adminUserId: admin.id,
      internalNote: dto.internalNote,
    });
  }

  @Post('missions/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander des modifications au Client' })
  requestChanges(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestMissionChangesDto,
  ) {
    return this.reviewService.requestChanges({
      missionId: id,
      adminUserId: admin.id,
      message: dto.message,
      areas: dto.areas,
      internalNote: dto.internalNote,
    });
  }

  @Post('missions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refuser la publication' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectMissionDto,
  ) {
    return this.reviewService.reject({
      missionId: id,
      adminUserId: admin.id,
      reasonCode: dto.reasonCode,
      reasonText: dto.reasonText,
      internalNote: dto.internalNote,
    });
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
