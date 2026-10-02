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
  Res,
  UploadedFile,
  UseInterceptors,
  type StreamableFile,
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { toDocumentResponse } from './document-content-response';
import {
  MAX_DOCUMENT_SIZE_BYTES,
  VerificationsService,
} from './verifications.service';

/** Sous-ensemble de `Express.Multer.File` (stockage mémoire). */
export type UploadedFileLike = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
};

@ApiTags('verifications')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class MeVerificationController {
  constructor(private readonly verifications: VerificationsService) {}

  @Get('me/verification')
  @ApiOperation({
    summary: 'État de ma vérification (identité, profil Jobber, pièces)',
  })
  getMyVerification(@CurrentUser() user: AuthenticatedUser) {
    return this.verifications.getMyVerification(user.id);
  }

  @Get('me/profile-completion')
  @ApiOperation({ summary: 'Complétion de mon dossier d’identité' })
  profileCompletion(@CurrentUser() user: AuthenticatedUser) {
    return this.verifications.getMyProfileCompletion(user.id);
  }

  @Patch('me/profile')
  @ApiOperation({ summary: 'Adresse, ville, pays et langues (remplacement)' })
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMyProfileDto,
  ) {
    return this.verifications.updateMyProfile(user.id, dto);
  }

  @Get('me/documents')
  @ApiOperation({ summary: 'Lister mes documents (sans chemin de stockage)' })
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.verifications.listMyDocuments(user.id);
  }

  @Post('me/documents')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Téléverser un document (multipart, champ `file`)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'documentTypeCode'],
      properties: {
        file: { type: 'string', format: 'binary' },
        documentTypeCode: { type: 'string', example: 'CIP' },
        identitySubType: { type: 'string', enum: ['CIP', 'PASSPORT'] },
        originalFilename: { type: 'string' },
        capturedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_SIZE_BYTES, files: 1 },
    }),
  )
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.verifications.createDocument(user.id, {
      documentTypeCode: dto.documentTypeCode,
      identitySubType: dto.identitySubType,
      mimeType: file?.mimetype ?? '',
      sizeBytes: file?.size,
      originalFilename: dto.originalFilename ?? file?.originalname ?? null,
      capturedAt: dto.capturedAt,
      fileBuffer: file?.buffer ?? Buffer.alloc(0),
    });
  }

  @Get('me/documents/:id/content')
  @ApiOperation({ summary: 'Contenu d’un de mes documents (flux privé)' })
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const content = await this.verifications.getDocumentContent(user, id);
    return toDocumentResponse(content, res);
  }

  @Post('me/verification/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soumettre mon dossier d’identité à vérification' })
  submit(@CurrentUser() user: AuthenticatedUser) {
    return this.verifications.submitIdentity(user.id);
  }
}
