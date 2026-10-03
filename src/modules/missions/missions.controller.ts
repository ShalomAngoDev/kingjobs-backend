import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { MissionVerificationType } from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CancelMissionDto } from './dto/cancel-mission.dto';
import { CreateMissionDto } from './dto/create-mission.dto';
import { MyMissionsQueryDto } from './dto/mission-queries.dto';
import { ReportIncidentDto } from './dto/report-incident.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';
import { ValidateVerificationDto } from './dto/validate-verification.dto';
import { MissionIncidentsService } from './mission-incidents.service';
import { MissionVerificationService } from './mission-verification.service';
import { MissionsService } from './missions.service';

type UploadedFileLike = {
  mimetype?: string;
  size?: number;
  originalname?: string;
  buffer?: Buffer;
};

/**
 * Routes Client + routes partagées Client/Jobber (cancel, incidents, détail).
 * Aucune route ne modifie `status` directement et AUCUNE ne confirme un paiement.
 */
@ApiTags('missions')
@ApiBearerAuth()
@Controller({ path: 'missions', version: '1' })
export class MissionsController {
  constructor(
    private readonly missionsService: MissionsService,
    private readonly verificationService: MissionVerificationService,
    private readonly incidentsService: MissionIncidentsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Créer une mission (DRAFT)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMissionDto,
  ) {
    return this.missionsService.create(user.id, dto);
  }

  // Routes statiques AVANT `:id`.
  @Get('me/client')
  @ApiOperation({ summary: 'Mes missions en tant que Client' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyMissionsQueryDto,
  ) {
    return this.missionsService.listMine(user.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail (adresse masquée selon le rôle)' })
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.missionsService.getDetail(user.id, id);
  }

  @Get(':id/media/:mediaId')
  @ApiOperation({ summary: 'Photo du besoin (flux privé authentifié)' })
  async mediaContent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const content = await this.missionsService.getMissionMediaContent(
      user.id,
      id,
      mediaId,
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Pas de `length` fixe : évite Content-Length ≠ octets réels
    // (fichiers restaurés / désync DB) qui fait planter le proxy BFF (fetch terminated).
    return new StreamableFile(content.stream, {
      type: content.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(content.filename)}`,
    });
  }

  @Post(':id/media')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Ajouter une photo à une mission (DRAFT / NEEDS_CHANGES)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MISSION_LIMITS.MAX_MISSION_MEDIA_BYTES,
        files: 1,
      },
    }),
  )
  addMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    const buffer = file?.buffer ?? Buffer.alloc(0);
    return this.missionsService.addMissionMedia(user.id, id, {
      buffer,
      mimeType: file?.mimetype ?? '',
      sizeBytes: file?.size ?? buffer.length,
      originalFilename: file?.originalname ?? null,
    });
  }

  @Delete(':id/media/:mediaId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Supprimer une photo de mission (DRAFT / NEEDS_CHANGES)',
  })
  deleteMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.missionsService.deleteMissionMedia(user.id, id, mediaId);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier une mission (DRAFT/PUBLISHED, champs limités)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMissionDto,
  ) {
    return this.missionsService.update(user.id, id, dto);
  }

  @Post(':id/submit-for-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soumettre la mission pour paiement (DRAFT → PAYMENT_REQUIRED)',
  })
  submitForPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.missionsService.submitForPayment(user.id, id);
  }

  @Post(':id/resubmit-for-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resoumettre après corrections (NEEDS_CHANGES → PENDING_REVIEW)',
  })
  resubmitForReview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.missionsService.resubmitForReview(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annuler (Client propriétaire ou Jobber sélectionné)',
  })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelMissionDto,
  ) {
    return this.missionsService.cancel(user.id, id, dto);
  }

  @Post(':id/request-completion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Jobber sélectionné : demander la clôture (IN_PROGRESS → COMPLETION_PENDING)',
  })
  requestCompletion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.missionsService.requestCompletion(user.id, id);
  }

  // ---------- Vérifications (codes / QR) ----------

  @Post(':id/verifications/start-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client : générer le code de début (affiché une seule fois)',
  })
  startCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.verificationService.generate(
      user.id,
      id,
      MissionVerificationType.START_CODE,
    );
  }

  @Post(':id/verifications/start-qr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client : générer le QR de début (jeton affiché une seule fois)',
  })
  startQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.verificationService.generate(
      user.id,
      id,
      MissionVerificationType.START_QR,
    );
  }

  @Post(':id/verifications/end-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client : générer le code de fin (COMPLETION_PENDING)',
  })
  endCode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.verificationService.generate(
      user.id,
      id,
      MissionVerificationType.END_CODE,
    );
  }

  @Post(':id/verifications/end-qr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Client : générer le QR de fin (COMPLETION_PENDING)',
  })
  endQr(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.verificationService.generate(
      user.id,
      id,
      MissionVerificationType.END_QR,
    );
  }

  @Post(':id/verifications/validate-start')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Jobber sélectionné : valider code/QR de début → IN_PROGRESS',
  })
  validateStart(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateVerificationDto,
  ) {
    return this.verificationService.validateStart(user.id, id, dto);
  }

  @Post(':id/verifications/validate-end')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Jobber sélectionné : valider code/QR de fin → COMPLETED',
  })
  validateEnd(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ValidateVerificationDto,
  ) {
    return this.verificationService.validateEnd(user.id, id, dto);
  }

  // ---------- Incidents ----------

  @Post(':id/incidents')
  @ApiOperation({
    summary: 'Signaler un incident (Client ou Jobber sélectionné)',
  })
  reportIncident(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportIncidentDto,
  ) {
    return this.incidentsService.report(user.id, id, dto);
  }
}
