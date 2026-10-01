import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AdminUsersService } from './admin-users.service';
import {
  AdminClientsQueryDto,
  AdminJobbersQueryDto,
  AdminUsersQueryDto,
} from './dto/admin-users-queries.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';

@ApiTags('admin-users')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiForbiddenResponse({ description: 'Rôle ADMIN / SUPER_ADMIN requis' })
@Controller({ path: 'admin', version: '1' })
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicateurs agrégés (compteurs uniquement)' })
  dashboard() {
    return this.adminUsersService.dashboard();
  }

  @Get('users')
  @ApiOperation({ summary: 'Lister les utilisateurs (pagination + filtres)' })
  listUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminUsersService.listUsers(query);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Détail utilisateur (profils Client / Jobber)' })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.getUser(id);
  }

  @Post('users/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspendre un compte (révoque ses sessions)' })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  @ApiForbiddenResponse({
    description: 'Auto-suspension ou ADMIN ciblant un SUPER_ADMIN',
  })
  @ApiUnprocessableEntityResponse({ description: 'Compte fermé' })
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.adminUsersService.suspend(actor, id, dto.reason);
  }

  @Post('users/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réactiver un compte suspendu' })
  @ApiNotFoundResponse({ description: 'Utilisateur introuvable' })
  @ApiForbiddenResponse({
    description: 'Auto-modification ou ADMIN ciblant un SUPER_ADMIN',
  })
  @ApiUnprocessableEntityResponse({ description: 'Compte fermé' })
  reactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminUsersService.reactivate(actor, id);
  }

  @Get('clients')
  @ApiOperation({
    summary: 'Lister les utilisateurs ayant un ClientProfile (+ missionsCount)',
  })
  listClients(@Query() query: AdminClientsQueryDto) {
    return this.adminUsersService.listClients(query);
  }

  @Get('jobbers')
  @ApiOperation({
    summary: 'Lister les utilisateurs ayant un JobberProfile',
  })
  listJobbers(@Query() query: AdminJobbersQueryDto) {
    return this.adminUsersService.listJobbers(query);
  }

  @Get('jobbers/:id')
  @ApiOperation({
    summary:
      'Détail Jobber : services, compétences, zones, éligibilité (id = User.id)',
  })
  @ApiNotFoundResponse({ description: 'Jobber introuvable' })
  getJobber(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminUsersService.getJobber(id);
  }
}
