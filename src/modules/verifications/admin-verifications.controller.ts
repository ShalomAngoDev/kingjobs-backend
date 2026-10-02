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
  Res,
  type StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AdminDocumentsQueryDto,
  AdminVerificationsQueryDto,
  ApproveCaseDto,
  ApproveDocumentDto,
  RejectCaseDto,
  RejectDocumentDto,
  RequestChangesDto,
  RequestDocumentChangesDto,
} from './dto/admin-review.dto';
import { toDocumentResponse } from './document-content-response';
import { VerificationsService } from './verifications.service';

@ApiTags('admin-verifications')
@ApiBearerAuth()
@Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
@ApiForbiddenResponse({ description: 'Rôle ADMIN / SUPER_ADMIN requis' })
@Controller({ path: 'admin', version: '1' })
export class AdminVerificationsController {
  constructor(private readonly verifications: VerificationsService) {}

  // ----- Dossiers -----

  @Get('verifications')
  @ApiOperation({ summary: 'Lister les dossiers de vérification' })
  list(@Query() query: AdminVerificationsQueryDto) {
    return this.verifications.adminListCases(query);
  }

  // Déclaré AVANT :id pour ne pas être capturé par ParseUUIDPipe.
  @Get('verifications/counts')
  @ApiOperation({ summary: 'Compteurs de vérification (tableau de bord)' })
  counts() {
    return this.verifications.getCounts();
  }

  @Get('verifications/:id')
  @ApiOperation({ summary: 'Détail d’un dossier (utilisateur, pièces, notes)' })
  @ApiNotFoundResponse({ description: 'Dossier introuvable' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.verifications.adminGetCase(id);
  }

  @Post('verifications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuver un dossier' })
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveCaseDto,
  ) {
    return this.verifications.adminApproveCase(id, admin.id, dto);
  }

  @Post('verifications/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander des corrections à l’utilisateur' })
  requestChanges(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestChangesDto,
  ) {
    return this.verifications.adminRequestChanges(id, admin.id, dto);
  }

  @Post('verifications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refuser un dossier' })
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectCaseDto,
  ) {
    return this.verifications.adminRejectCase(id, admin.id, dto);
  }

  // ----- Documents -----

  @Get('documents')
  @ApiOperation({ summary: 'Lister les documents' })
  listDocuments(@Query() query: AdminDocumentsQueryDto) {
    return this.verifications.adminListDocuments(query);
  }

  @Get('documents/:id')
  @ApiOperation({ summary: 'Détail d’un document (journal d’événements)' })
  getDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.verifications.adminGetDocument(id);
  }

  @Get('documents/:id/content')
  @ApiOperation({
    summary: 'Contenu d’un document (flux privé, consultation journalisée)',
  })
  async documentContent(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const content = await this.verifications.getDocumentContent(admin, id);
    return toDocumentResponse(content, res);
  }

  @Post('documents/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approuver un document' })
  approveDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDocumentDto,
  ) {
    return this.verifications.adminApproveDocument(id, admin.id, dto);
  }

  @Post('documents/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refuser un document' })
  rejectDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectDocumentDto,
  ) {
    return this.verifications.adminRejectDocument(id, admin.id, dto);
  }

  @Post('documents/:id/request-changes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demander le remplacement d’un document' })
  requestDocumentChanges(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestDocumentChangesDto,
  ) {
    return this.verifications.adminRequestDocumentChanges(id, admin.id, dto);
  }
}
