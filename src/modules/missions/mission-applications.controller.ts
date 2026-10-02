import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ApplyMissionDto } from './dto/apply-mission.dto';
import { MissionApplicationsService } from './mission-applications.service';

class CancelAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@ApiTags('mission-applications')
@ApiBearerAuth()
@Controller({ path: 'missions', version: '1' })
export class MissionApplicationsController {
  constructor(private readonly applications: MissionApplicationsService) {}

  @Post(':id/applications')
  @ApiOperation({ summary: 'Jobber : postuler à une mission publiée' })
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyMissionDto,
  ) {
    return this.applications.apply(user.id, id, dto);
  }

  @Get(':id/applications')
  @ApiOperation({
    summary: 'Client : candidatures reçues (infos Jobber publiques)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.applications.listForClient(user.id, id);
  }

  @Post(':missionId/applications/:applicationId/select')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Client : sélectionner un Jobber (MissionAssignment, multi-places)',
  })
  select(
    @CurrentUser() user: AuthenticatedUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.applications.select(user.id, missionId, applicationId);
  }

  @Post(':missionId/applications/:applicationId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Client : ne pas retenir une candidature PENDING' })
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.applications.reject(user.id, missionId, applicationId);
  }

  @Post(':missionId/applications/:applicationId/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Jobber : retirer sa candidature (PENDING uniquement)',
  })
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ) {
    return this.applications.withdraw(user.id, missionId, applicationId);
  }

  @Post(':missionId/assignments/:assignmentId/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client ou Jobber : annuler une affectation ACTIVE',
  })
  cancelAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CancelAssignmentDto,
  ) {
    return this.applications.cancelAssignment(
      user.id,
      missionId,
      assignmentId,
      dto.reason,
    );
  }
}
