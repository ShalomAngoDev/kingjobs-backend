import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AddJobberServiceDto } from './dto/add-jobber-service.dto';
import { CreateJobberSkillDto } from './dto/create-jobber-skill.dto';
import { CreateServiceAreaDto } from './dto/create-service-area.dto';
import { UpdateJobberMeDto } from './dto/update-jobber-me.dto';
import { UpdateJobberServiceDto } from './dto/update-jobber-service.dto';
import { UpdateServiceAreaDto } from './dto/update-service-area.dto';
import { JobbersService } from './jobbers.service';

@ApiTags('jobbers')
@ApiBearerAuth()
@Controller({ path: 'jobbers', version: '1' })
export class JobbersController {
  constructor(
    private readonly authService: AuthService,
    private readonly jobbersService: JobbersService,
  ) {}

  @Post('me/activate')
  @ApiOperation({ summary: 'Activer le profil Jobber sur le compte existant' })
  activate(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.activateJobber(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Profil Jobber courant' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getJobberMe(user.id);
  }

  @Patch('me')
  @ApiOperation({
    summary: 'Mettre à jour le profil Jobber (titre, bio, expérience)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateJobberMeDto,
  ) {
    return this.authService.updateJobberMe(user.id, dto);
  }

  // ----- Services -----

  @Get('me/services')
  @ApiOperation({ summary: 'Lister mes services' })
  listServices(@CurrentUser() user: AuthenticatedUser) {
    return this.jobbersService.listMyServices(user.id);
  }

  @Post('me/services')
  @ApiOperation({ summary: 'Ajouter un service à mon profil' })
  addService(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddJobberServiceDto,
  ) {
    return this.jobbersService.addService(user.id, dto);
  }

  @Patch('me/services/:serviceId')
  @ApiOperation({ summary: 'Modifier mon expérience sur un service' })
  updateService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
    @Body() dto: UpdateJobberServiceDto,
  ) {
    return this.jobbersService.updateService(user.id, serviceId, dto);
  }

  @Delete('me/services/:serviceId')
  @ApiOperation({ summary: 'Retirer un service de mon profil' })
  removeService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.jobbersService.removeService(user.id, serviceId);
  }

  // ----- Zones d'intervention -----

  @Get('me/service-areas')
  @ApiOperation({ summary: 'Lister mes zones d’intervention' })
  listAreas(@CurrentUser() user: AuthenticatedUser) {
    return this.jobbersService.listAreas(user.id);
  }

  @Post('me/service-areas')
  @ApiOperation({ summary: 'Ajouter une zone d’intervention' })
  addArea(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateServiceAreaDto,
  ) {
    return this.jobbersService.addArea(user.id, dto);
  }

  @Patch('me/service-areas/:id')
  @ApiOperation({ summary: 'Modifier une zone d’intervention' })
  updateArea(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceAreaDto,
  ) {
    return this.jobbersService.updateArea(user.id, id, dto);
  }

  @Delete('me/service-areas/:id')
  @ApiOperation({ summary: 'Supprimer une zone d’intervention' })
  removeArea(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobbersService.removeArea(user.id, id);
  }

  // ----- Compétences -----

  @Get('me/skills')
  @ApiOperation({ summary: 'Lister mes compétences' })
  listSkills(@CurrentUser() user: AuthenticatedUser) {
    return this.jobbersService.listSkills(user.id);
  }

  @Post('me/skills')
  @ApiOperation({ summary: 'Ajouter une compétence' })
  addSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJobberSkillDto,
  ) {
    return this.jobbersService.addSkill(user.id, dto);
  }

  @Delete('me/skills/:id')
  @ApiOperation({ summary: 'Supprimer une compétence' })
  removeSkill(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.jobbersService.removeSkill(user.id, id);
  }

  // ----- Complétion & éligibilité -----

  @Get('me/profile-completion')
  @ApiOperation({ summary: 'Complétion du profil Jobber' })
  profileCompletion(@CurrentUser() user: AuthenticatedUser) {
    return this.jobbersService.getProfileCompletion(user.id);
  }

  @Get('me/eligibility')
  @ApiOperation({ summary: 'Éligibilité pour tous mes services' })
  eligibility(@CurrentUser() user: AuthenticatedUser) {
    return this.jobbersService.getEligibility(user.id);
  }

  @Get('me/eligibility/:serviceId')
  @ApiOperation({ summary: 'Éligibilité pour un service donné' })
  eligibilityForService(
    @CurrentUser() user: AuthenticatedUser,
    @Param('serviceId', ParseUUIDPipe) serviceId: string,
  ) {
    return this.jobbersService.getEligibility(user.id, serviceId);
  }
}
