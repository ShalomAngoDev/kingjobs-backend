import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  AdminAuditAction,
  IdentityDocumentSubType,
  IdentityVerificationStatus,
  JobberStatus,
  LegalGuardianStatus,
  ServiceRequirementType,
  UserDocumentStatus,
  UserRole,
  UserStatus,
  VerificationCaseKind,
  VerificationCaseStatus,
  type DocumentType,
  type Prisma,
  type User,
  type UserDocument,
  type VerificationCase,
} from '@prisma/client';
import { EmailService } from '../../infrastructure/email/email.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  FILE_STORAGE,
  StorageObjectNotFoundError,
  sanitizeOriginalFilename,
  type FileStorageService,
} from '../../infrastructure/storage/file-storage.types';
import type { StorageConfig } from '../../config/configuration';
import { ConfigService } from '@nestjs/config';
import { JobberServiceEligibilitySync } from '../eligibility/jobber-service-eligibility-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  notifyIdentityVerified,
  notifyJobberNeedsChanges,
  notifyJobberProfileVerified,
  notifyJobberRejected,
} from '../notifications/notification-events';
import {
  avatarUrlFromProfilePhotoId,
  loadApprovedProfilePhotoIds,
} from './profile-photo';
import {
  buildVerificationDecisionEmail,
  type VerificationEmailKind,
} from './verification-emails';
import type {
  AdminDocumentsQueryDto,
  AdminVerificationsQueryDto,
  ApproveCaseDto,
  ApproveDocumentDto,
  RejectCaseDto,
  RejectDocumentDto,
  RequestChangesDto,
  RequestDocumentChangesDto,
} from './dto/admin-review.dto';
import type { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import {
  DOCUMENT_CODES,
  IDENTITY_CASE_DOCUMENT_CODES,
  IdentityCompletionService,
  USABLE_DOCUMENT_STATUSES,
  type DocumentPresence,
  type IdentityCompletionResult,
} from './identity-completion.service';
import {
  serializeCaseForAdmin,
  serializeCaseForUser,
  serializeDocumentForAdmin,
  serializeDocumentForUser,
  type DocumentRequirementMeta,
} from './verification-serializers';
import {
  assertCaseTransition,
  assertIdentityTransition,
  assertJobberTransition,
} from './verification-state-machine';

type Db = Prisma.TransactionClient;

export const MAX_DOCUMENT_SIZE_BYTES = 8 * 1024 * 1024;
export const ALLOWED_DOCUMENT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];
const IMAGE_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];
/** Fenêtre de validité d'un selfie live (anti-réutilisation d'une ancienne photo). */
const SELFIE_MAX_AGE_MS = 30 * 60 * 1000;
const SELFIE_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

const DEFAULT_LIMIT = 20;

export type DocumentActor = { id: string; role: UserRole };

export type CreateDocumentInput = {
  documentTypeCode: string;
  identitySubType?: IdentityDocumentSubType | null;
  mimeType: string;
  sizeBytes?: number;
  originalFilename?: string | null;
  capturedAt?: Date | string | null;
  fileBuffer: Buffer;
};

export type DocumentContent = {
  stream: Readable;
  mimeType: string;
  filename: string;
  sizeBytes: number;
};

type Review = {
  adminId: string;
  userMessage?: string | null;
  reasonCode?: string | null;
  internalNote?: string | null;
};

function isAdminRole(role: UserRole): boolean {
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;
}

/** Signature binaire minimale : le MIME déclaré par le client n'est pas fiable. */
function matchesMagicBytes(mimeType: string, buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  switch (mimeType) {
    case 'image/jpeg':
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case 'image/png':
      return (
        buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG'
      );
    case 'image/webp':
      return (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
      );
    case 'application/pdf':
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    default:
      return false;
  }
}

@Injectable()
export class VerificationsService {
  private readonly logger = new Logger(VerificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorageService,
    private readonly identityCompletion: IdentityCompletionService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly eligibilitySync: JobberServiceEligibilitySync,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Côté utilisateur
  // ---------------------------------------------------------------------------

  async getMyVerification(userId: string) {
    const user = await this.requireUser(this.prisma, userId);
    const [languages, documents, identityCase, jobberCase, jobberProfile] =
      await Promise.all([
        this.prisma.userLanguage.findMany({ where: { userId } }),
        this.loadDocuments(this.prisma, userId),
        this.latestCase(this.prisma, userId, VerificationCaseKind.IDENTITY),
        this.latestCase(
          this.prisma,
          userId,
          VerificationCaseKind.JOBBER_PROFILE,
        ),
        this.prisma.jobberProfile.findUnique({ where: { userId } }),
      ]);

    const completion = this.completionOf(documents);
    const globallyVerified =
      user.identityVerificationStatus === IdentityVerificationStatus.VERIFIED &&
      jobberProfile?.status === JobberStatus.ACTIVE;

    return {
      identity: {
        status: user.identityVerificationStatus,
        legalGuardianStatus: user.legalGuardianStatus,
        case: identityCase ? serializeCaseForUser(identityCase) : null,
        completion,
      },
      jobberProfile: jobberProfile
        ? {
            status: jobberProfile.status,
            case: jobberCase ? serializeCaseForUser(jobberCase) : null,
          }
        : null,
      /** Calculé : identity VERIFIED + jobber ACTIVE. Non persisté. */
      globallyVerified,
      profile: {
        addressLine: user.addressLine ?? null,
        city: user.city ?? null,
        countryCode: user.countryCode ?? 'BJ',
        administrativeArea: user.administrativeArea ?? null,
        languages: languages.map((l) => ({ code: l.code, label: l.label })),
      },
      documents: documents
        .filter((d) => d.doc.status !== UserDocumentStatus.EXPIRED)
        .map((d) => serializeDocumentForUser(d.doc, d.documentTypeCode)),
    };
  }

  /** Complétion du dossier d'identité (calcul dérivé, non stocké). */
  async getMyProfileCompletion(userId: string) {
    const user = await this.requireUser(this.prisma, userId);
    const [languagesCount, documents] = await Promise.all([
      this.prisma.userLanguage.count({ where: { userId } }),
      this.loadDocuments(this.prisma, userId),
    ]);
    const docCompletion = this.completionOf(documents);

    const checks: Array<{ code: string; ok: boolean }> = [
      { code: 'EMAIL_VERIFIED', ok: Boolean(user.emailVerifiedAt) },
      { code: 'PHONE_VERIFIED', ok: Boolean(user.phoneVerifiedAt) },
      { code: 'ADDRESS', ok: Boolean(user.addressLine && user.city) },
      { code: 'LANGUAGES', ok: languagesCount >= 1 },
      ...[
        DOCUMENT_CODES.IDENTITY_DOCUMENT,
        DOCUMENT_CODES.RESIDENCE_CERTIFICATE,
        DOCUMENT_CODES.LIVE_SELFIE,
      ].map((code) => ({
        code,
        ok: !docCompletion.missing.includes(code),
      })),
      {
        code: 'IDENTITY_VERIFIED',
        ok:
          user.identityVerificationStatus ===
          IdentityVerificationStatus.VERIFIED,
      },
    ];
    const completed = checks.filter((c) => c.ok).map((c) => c.code);
    const missing = checks.filter((c) => !c.ok).map((c) => c.code);
    return {
      percentage: Math.round((completed.length / checks.length) * 100),
      completed,
      missing,
    };
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    await this.requireUser(this.prisma, userId);

    const data: Prisma.UserUpdateInput = {};
    if (dto.addressLine !== undefined) data.addressLine = dto.addressLine;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.countryCode !== undefined) {
      data.countryCode = dto.countryCode.toUpperCase();
    }
    if (dto.administrativeArea !== undefined) {
      data.administrativeArea = dto.administrativeArea;
    }

    let languages: Array<{ code: string; label: string }> | undefined;
    if (dto.languages !== undefined) {
      const seen = new Set<string>();
      languages = [];
      for (const language of dto.languages) {
        const code = language.code.trim().toLowerCase();
        if (seen.has(code)) continue;
        seen.add(code);
        languages.push({ code, label: language.label.trim() });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.user.update({ where: { id: userId }, data });
      }
      if (languages !== undefined) {
        await tx.userLanguage.deleteMany({ where: { userId } });
        if (languages.length > 0) {
          await tx.userLanguage.createMany({
            data: languages.map((l) => ({ userId, ...l })),
          });
        }
      }
    });

    return this.getMyVerification(userId).then((v) => v.profile);
  }

  async listMyDocuments(userId: string) {
    const documents = await this.loadDocuments(this.prisma, userId);
    return {
      items: documents
        .filter((d) => d.doc.status !== UserDocumentStatus.EXPIRED)
        .map((d) => serializeDocumentForUser(d.doc, d.documentTypeCode)),
    };
  }

  async createDocument(userId: string, input: CreateDocumentInput) {
    const user = await this.requireUser(this.prisma, userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Votre compte n’est pas actif.');
    }

    const buffer = input.fileBuffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new BadRequestException('Fichier manquant ou vide.');
    }
    const maxBytes =
      this.configService.get<StorageConfig>('storage')?.maxUploadBytes ??
      MAX_DOCUMENT_SIZE_BYTES;
    if (buffer.byteLength > maxBytes) {
      throw new PayloadTooLargeException(
        `Fichier trop volumineux (${Math.floor(maxBytes / (1024 * 1024))} Mo maximum).`,
      );
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(input.mimeType)) {
      throw new BadRequestException(
        'Format non accepté. Formats autorisés : JPEG, PNG, WebP, PDF.',
      );
    }
    if (!matchesMagicBytes(input.mimeType, buffer)) {
      throw new BadRequestException(
        'Le contenu du fichier ne correspond pas à son format.',
      );
    }

    const documentType = await this.prisma.documentType.findUnique({
      where: { code: input.documentTypeCode },
    });
    if (!documentType || !documentType.isActive) {
      throw new BadRequestException('Type de document inconnu.');
    }
    const code = documentType.code;

    // IDENTITY_DOCUMENT est legacy : nouvelles soumissions = CIP ou PASSPORT.
    if (code === DOCUMENT_CODES.IDENTITY_DOCUMENT) {
      throw new BadRequestException(
        'Utilisez CIP ou PASSPORT comme type de pièce d’identité.',
      );
    }

    if (
      code === DOCUMENT_CODES.LIVE_SELFIE &&
      !IMAGE_MIME_TYPES.includes(input.mimeType)
    ) {
      throw new BadRequestException('Le selfie doit être une image.');
    }

    const identitySubType = this.resolveSubType(code, input.identitySubType);
    const capturedAt = this.resolveCapturedAt(code, input.capturedAt);
    const originalFilename = sanitizeOriginalFilename(input.originalFilename);

    if (
      IDENTITY_CASE_DOCUMENT_CODES.includes(code) &&
      user.identityVerificationStatus !==
        IdentityVerificationStatus.UNVERIFIED &&
      user.identityVerificationStatus !==
        IdentityVerificationStatus.NEEDS_CHANGES
    ) {
      throw new ConflictException(
        user.identityVerificationStatus === IdentityVerificationStatus.PENDING
          ? 'Votre dossier est en cours d’examen : les pièces ne peuvent plus être modifiées.'
          : 'Votre identité est déjà traitée : les pièces ne peuvent plus être modifiées.',
      );
    }

    const stored = await this.storage.put({
      buffer,
      mimeType: input.mimeType,
      ownerId: userId,
      keyPrefix: 'verification',
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Remplacement : nouvel objet storage (clé différente), ancien marqué EXPIRED.
        // Pas de purge physique auto (rétention à finaliser).
        const previous = await tx.userDocument.findMany({
          where: {
            userId,
            documentTypeId: documentType.id,
            status: {
              in: [
                UserDocumentStatus.PENDING,
                UserDocumentStatus.UNDER_REVIEW,
                UserDocumentStatus.NEEDS_CHANGES,
                UserDocumentStatus.REJECTED,
              ],
            },
          },
        });

        const created = await tx.userDocument.create({
          data: {
            userId,
            documentTypeId: documentType.id,
            identitySubType,
            status: UserDocumentStatus.PENDING,
            storageKey: stored.key,
            mimeType: input.mimeType,
            sizeBytes: stored.sizeBytes,
            originalFilename,
            capturedAt,
          },
        });
        await this.recordDocumentEvent(tx, created.id, userId, 'UPLOADED', {
          mimeType: input.mimeType,
          sizeBytes: stored.sizeBytes,
          source:
            code === DOCUMENT_CODES.LIVE_SELFIE ? 'LIVE_CAPTURE' : 'UPLOAD',
        });

        for (const old of previous) {
          await tx.userDocument.update({
            where: { id: old.id },
            data: { status: UserDocumentStatus.EXPIRED },
          });
          await this.recordDocumentEvent(tx, old.id, userId, 'REPLACED', {
            replacedBy: created.id,
          });
        }
        return serializeDocumentForUser(created, code);
      });
    } catch (error) {
      // Compensation : objet orphelin si DB échoue après put.
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    }
  }

  /** Propriétaire ou ADMIN / SUPER_ADMIN. Les autres reçoivent 404 (pas de fuite d'existence). */
  async getDocumentContent(
    actor: DocumentActor,
    documentId: string,
  ): Promise<DocumentContent> {
    const doc = await this.prisma.userDocument.findUnique({
      where: { id: documentId },
    });
    const isOwner = doc?.userId === actor.id;
    if (!doc || (!isOwner && !isAdminRole(actor.role))) {
      throw new NotFoundException('Document introuvable');
    }

    let stream: Readable;
    try {
      stream = await this.storage.getStream(doc.storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException('Fichier introuvable');
      }
      throw error;
    }

    if (!isOwner) {
      await this.recordDocumentEvent(
        this.prisma,
        doc.id,
        actor.id,
        'ADMIN_VIEWED',
      );
      const type = await this.prisma.documentType.findUnique({
        where: { id: doc.documentTypeId },
        select: { code: true },
      });
      const sensitiveCodes: readonly string[] = [
        DOCUMENT_CODES.CIP,
        DOCUMENT_CODES.PASSPORT,
        DOCUMENT_CODES.IDENTITY_DOCUMENT,
        DOCUMENT_CODES.RESIDENCE_CERTIFICATE,
        DOCUMENT_CODES.LIVE_SELFIE,
      ];
      if (type && sensitiveCodes.includes(type.code)) {
        await this.recordAdminAudit(
          actor.id,
          AdminAuditAction.VIEW_VERIFICATION_DOCUMENT,
          'USER_DOCUMENT',
          doc.id,
          {
            userId: doc.userId,
            documentTypeCode: type.code,
            verificationCaseId: doc.verificationCaseId,
          },
        );
      }
    }

    return {
      stream,
      mimeType: doc.mimeType,
      filename: doc.originalFilename ?? `document-${doc.id}`,
      sizeBytes: doc.sizeBytes,
    };
  }

  async submitIdentity(userId: string) {
    const user = await this.requireUser(this.prisma, userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Votre compte n’est pas actif.');
    }
    assertIdentityTransition(
      user.identityVerificationStatus,
      IdentityVerificationStatus.PENDING,
    );

    const documents = await this.loadDocuments(this.prisma, userId);
    const completion = this.completionOf(documents);
    if (!completion.complete) {
      throw new BadRequestException({
        message: `Dossier incomplet. Pièces manquantes : ${completion.missing.join(', ')}.`,
        missing: completion.missing,
      });
    }

    const attachIds = documents
      .filter(
        (d) =>
          IDENTITY_CASE_DOCUMENT_CODES.includes(d.documentTypeCode) &&
          USABLE_DOCUMENT_STATUSES.includes(d.doc.status),
      )
      .map((d) => d.doc.id);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const verificationCase = await this.openCase(
        tx,
        userId,
        VerificationCaseKind.IDENTITY,
        now,
      );

      const claimed = await tx.user.updateMany({
        where: {
          id: userId,
          identityVerificationStatus: user.identityVerificationStatus,
        },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.PENDING,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Votre dossier a déjà été soumis.');
      }

      if (attachIds.length > 0) {
        await tx.userDocument.updateMany({
          where: { id: { in: attachIds } },
          data: { verificationCaseId: verificationCase.id },
        });
      }
      return serializeCaseForUser(verificationCase);
    });
  }

  async submitJobberProfile(userId: string) {
    const user = await this.requireUser(this.prisma, userId);
    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Votre compte n’est pas actif.');
    }
    if (
      user.identityVerificationStatus === IdentityVerificationStatus.REJECTED
    ) {
      throw new ForbiddenException(
        'Votre identité a été refusée. Contactez le support KingJOBS.',
      );
    }

    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    assertJobberTransition(profile.status, JobberStatus.PENDING_VERIFICATION);

    const documents = await this.loadDocuments(this.prisma, userId);
    const identityNeedsSubmission =
      user.identityVerificationStatus ===
        IdentityVerificationStatus.UNVERIFIED ||
      user.identityVerificationStatus ===
        IdentityVerificationStatus.NEEDS_CHANGES;

    // Jobber = un seul envoi : identité (si besoin) + profil professionnel.
    if (identityNeedsSubmission) {
      const completion = this.completionOf(documents);
      if (!completion.complete) {
        throw new BadRequestException({
          message: `Dossier incomplet. Pièces manquantes : ${completion.missing.join(', ')}.`,
          missing: completion.missing,
        });
      }
      assertIdentityTransition(
        user.identityVerificationStatus,
        IdentityVerificationStatus.PENDING,
      );
    } else if (
      user.identityVerificationStatus !== IdentityVerificationStatus.VERIFIED &&
      user.identityVerificationStatus !== IdentityVerificationStatus.PENDING
    ) {
      throw new ForbiddenException(
        'Votre identité doit être vérifiée avant de soumettre votre profil Jobber.',
      );
    }

    const identityAttachIds = documents
      .filter(
        (d) =>
          IDENTITY_CASE_DOCUMENT_CODES.includes(d.documentTypeCode) &&
          USABLE_DOCUMENT_STATUSES.includes(d.doc.status),
      )
      .map((d) => d.doc.id);
    const jobberAttachIds = documents
      .filter(
        (d) =>
          !IDENTITY_CASE_DOCUMENT_CODES.includes(d.documentTypeCode) &&
          USABLE_DOCUMENT_STATUSES.includes(d.doc.status),
      )
      .map((d) => d.doc.id);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      if (identityNeedsSubmission) {
        const identityCase = await this.openCase(
          tx,
          userId,
          VerificationCaseKind.IDENTITY,
          now,
        );
        const claimedIdentity = await tx.user.updateMany({
          where: {
            id: userId,
            identityVerificationStatus: user.identityVerificationStatus,
          },
          data: {
            identityVerificationStatus: IdentityVerificationStatus.PENDING,
          },
        });
        if (claimedIdentity.count !== 1) {
          throw new ConflictException('Votre dossier a déjà été soumis.');
        }
        if (identityAttachIds.length > 0) {
          await tx.userDocument.updateMany({
            where: { id: { in: identityAttachIds } },
            data: { verificationCaseId: identityCase.id },
          });
        }
      }

      const verificationCase = await this.openCase(
        tx,
        userId,
        VerificationCaseKind.JOBBER_PROFILE,
        now,
      );
      const claimed = await tx.jobberProfile.updateMany({
        where: { id: profile.id, status: profile.status },
        data: { status: JobberStatus.PENDING_VERIFICATION },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Votre profil a déjà été soumis.');
      }
      if (jobberAttachIds.length > 0) {
        await tx.userDocument.updateMany({
          where: { id: { in: jobberAttachIds } },
          data: { verificationCaseId: verificationCase.id },
        });
      }
      return serializeCaseForUser(verificationCase);
    });
  }

  // ---------------------------------------------------------------------------
  // Côté admin : dossiers
  // ---------------------------------------------------------------------------

  async adminListCases(query: AdminVerificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.VerificationCaseWhereInput = {};
    if (query.kind) where.kind = query.kind;
    if (query.status) where.status = query.status;
    if (query.search) {
      const term = query.search;
      const users = await this.prisma.user.findMany({
        where: {
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term } },
          ],
        },
        select: { id: true },
        take: 200,
      });
      where.userId = { in: users.map((u) => u.id) };
    }

    const [total, cases] = await Promise.all([
      this.prisma.verificationCase.count({ where }),
      this.prisma.verificationCase.findMany({
        where,
        orderBy:
          query.status === VerificationCaseStatus.PENDING
            ? { submittedAt: 'asc' }
            : { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const users = await this.prisma.user.findMany({
      where: { id: { in: cases.map((c) => c.userId) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        city: true,
        countryCode: true,
        identityVerificationStatus: true,
        legalGuardianStatus: true,
      },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const avatars = await loadApprovedProfilePhotoIds(
      this.prisma,
      users.map((u) => u.id),
    );

    // Complétude par dossier (pas une file documents indépendante).
    const docsByUser = new Map<
      string,
      Array<{
        documentTypeCode: string;
        status: UserDocumentStatus;
        caseId: string | null;
      }>
    >();
    if (cases.length > 0) {
      const loaded = await Promise.all(
        [...new Set(cases.map((c) => c.userId))].map(async (userId) => ({
          userId,
          docs: await this.loadDocuments(this.prisma, userId),
        })),
      );
      for (const row of loaded) {
        docsByUser.set(
          row.userId,
          row.docs.map((d) => ({
            documentTypeCode: d.documentTypeCode,
            status: d.doc.status,
            caseId: d.doc.verificationCaseId,
          })),
        );
      }
    }

    return {
      items: cases.map((c) => {
        const user = byId.get(c.userId) ?? null;
        return {
          ...serializeCaseForAdmin(c),
          user: user
            ? {
                ...user,
                avatarUrl: avatarUrlFromProfilePhotoId(avatars.get(c.userId)),
              }
            : null,
          documentsSummary: this.documentsSummaryForList(
            c,
            docsByUser.get(c.userId) ?? [],
          ),
        };
      }),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminGetCase(id: string) {
    const verificationCase = await this.requireCase(this.prisma, id);
    const user = await this.prisma.user.findUnique({
      where: { id: verificationCase.userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        status: true,
        identityVerificationStatus: true,
        legalGuardianStatus: true,
        addressLine: true,
        city: true,
        countryCode: true,
        administrativeArea: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
    const [documents, languages, avatars] = await Promise.all([
      this.loadDocuments(this.prisma, verificationCase.userId),
      this.prisma.userLanguage.findMany({
        where: { userId: verificationCase.userId },
      }),
      loadApprovedProfilePhotoIds(this.prisma, [verificationCase.userId]),
    ]);
    const relevant = documents.filter((d) => {
      if (d.doc.verificationCaseId === verificationCase.id) return true;
      if (
        verificationCase.status === VerificationCaseStatus.PENDING &&
        d.doc.verificationCaseId === null
      ) {
        return true;
      }
      // Dossier Jobber : afficher aussi l'identité commune déjà vérifiée.
      if (
        verificationCase.kind === VerificationCaseKind.JOBBER_PROFILE &&
        IDENTITY_CASE_DOCUMENT_CODES.includes(d.documentTypeCode)
      ) {
        return true;
      }
      return false;
    });

    const requirementByCode = await this.resolveDocumentRequirements(
      this.prisma,
      verificationCase,
    );

    let jobberProfile: unknown = null;
    if (verificationCase.kind === VerificationCaseKind.JOBBER_PROFILE) {
      const profile = await this.prisma.jobberProfile.findUnique({
        where: { userId: verificationCase.userId },
      });
      if (profile) {
        const [educations, experiences, skills, jobberServices] =
          await Promise.all([
            this.prisma.jobberEducation.findMany({
              where: { jobberProfileId: profile.id },
            }),
            this.prisma.jobberExperience.findMany({
              where: { jobberProfileId: profile.id },
            }),
            this.prisma.jobberSkill.findMany({
              where: { jobberProfileId: profile.id },
              orderBy: { name: 'asc' },
            }),
            this.prisma.jobberService.findMany({
              where: { jobberProfileId: profile.id },
            }),
          ]);
        const services = await this.prisma.service.findMany({
          where: { id: { in: jobberServices.map((js) => js.serviceId) } },
        });
        const serviceById = new Map(services.map((s) => [s.id, s]));
        jobberProfile = {
          status: profile.status,
          headline: profile.headline,
          bio: profile.bio,
          yearsOfExperience: profile.yearsOfExperience,
          educations,
          experiences,
          skills: skills.map((s) => ({
            id: s.id,
            name: s.name,
            kind: s.kind,
          })),
          services: jobberServices.map((js) => {
            const service = serviceById.get(js.serviceId);
            return {
              id: js.id,
              serviceId: js.serviceId,
              name: service?.name ?? null,
              slug: service?.slug ?? null,
              status: js.status,
            };
          }),
        };
      }
    }

    const serializedDocs = relevant.map((d) =>
      serializeDocumentForAdmin(
        d.doc,
        d.documentTypeCode,
        undefined,
        this.requirementMetaFor(
          verificationCase.kind,
          d.documentTypeCode,
          requirementByCode,
        ),
      ),
    );

    const mandatoryDocs = serializedDocs.filter(
      (d) => d.requirement?.mandatory,
    );
    const optionalDocs = serializedDocs.filter(
      (d) => !d.requirement?.mandatory,
    );
    const documentsReviewSummary = {
      received: serializedDocs.length,
      mandatoryApproved: mandatoryDocs.filter(
        (d) => d.status === UserDocumentStatus.APPROVED,
      ).length,
      mandatoryTotal: mandatoryDocs.length,
      optionalPending: optionalDocs.filter(
        (d) =>
          d.status === UserDocumentStatus.PENDING ||
          d.status === UserDocumentStatus.UNDER_REVIEW,
      ).length,
    };

    return {
      case: serializeCaseForAdmin(verificationCase),
      user: user
        ? {
            ...user,
            dateOfBirth: user.dateOfBirth
              ? user.dateOfBirth.toISOString().slice(0, 10)
              : null,
            languages: languages.map((l) => ({ code: l.code, label: l.label })),
            avatarUrl: avatarUrlFromProfilePhotoId(
              avatars.get(verificationCase.userId),
            ),
          }
        : null,
      documents: serializedDocs,
      documentsReviewSummary,
      completion:
        verificationCase.kind === VerificationCaseKind.IDENTITY
          ? this.completionOf(documents)
          : null,
      jobberProfile,
    };
  }

  async adminApproveCase(
    id: string,
    adminId: string,
    dto: ApproveCaseDto = {},
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const verificationCase = await this.requireCase(tx, id);
      this.assertNotSelfReview(verificationCase.userId, adminId);
      assertCaseTransition(
        verificationCase.status,
        VerificationCaseStatus.APPROVED,
      );

      const user = await this.requireUser(tx, verificationCase.userId);
      this.assertGuardianNotBlocking(user.legalGuardianStatus);

      const now = new Date();
      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        assertIdentityTransition(
          user.identityVerificationStatus,
          IdentityVerificationStatus.VERIFIED,
        );
        const documents = await this.loadDocuments(tx, user.id);
        const approval = this.identityCompletion.checkApproved(
          documents.map((d) => ({
            documentTypeCode: d.documentTypeCode,
            status: d.doc.status,
          })),
        );
        if (!approval.complete) {
          throw new BadRequestException(
            `Impossible de valider : pièces obligatoires non approuvées (${approval.missing.join(', ')}).`,
          );
        }
      } else {
        // Dossier Jobber = paquet unique : identité + profil.
        // Si l'identité n'est pas encore VERIFIED, on la valide dans la même décision.
        if (
          user.identityVerificationStatus !==
          IdentityVerificationStatus.VERIFIED
        ) {
          if (
            user.identityVerificationStatus !==
            IdentityVerificationStatus.PENDING
          ) {
            throw new BadRequestException(
              'L’identité doit être soumise avant de valider le profil Jobber.',
            );
          }
          assertIdentityTransition(
            user.identityVerificationStatus,
            IdentityVerificationStatus.VERIFIED,
          );
          const documents = await this.loadDocuments(tx, user.id);
          const approval = this.identityCompletion.checkApproved(
            documents.map((d) => ({
              documentTypeCode: d.documentTypeCode,
              status: d.doc.status,
            })),
          );
          if (!approval.complete) {
            throw new BadRequestException(
              `Impossible de valider : pièces d’identité non approuvées (${approval.missing.join(', ')}).`,
            );
          }
        }
        const profile = await this.requireJobberProfile(tx, user.id);
        assertJobberTransition(profile.status, JobberStatus.ACTIVE);
        await this.assertJobberCaseReadyForApproval(tx, profile.id);
      }

      await this.claimCase(tx, verificationCase, {
        status: VerificationCaseStatus.APPROVED,
        reviewedAt: now,
        reviewedById: adminId,
        userMessage: null,
        reasonCode: null,
        internalNote: dto.internalNote ?? null,
      });

      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        await this.setIdentityStatus(
          tx,
          user,
          IdentityVerificationStatus.VERIFIED,
        );
      } else {
        if (
          user.identityVerificationStatus !==
          IdentityVerificationStatus.VERIFIED
        ) {
          await this.setIdentityStatus(
            tx,
            user,
            IdentityVerificationStatus.VERIFIED,
          );
          // Ferme le dossier identité lié s'il est encore en attente.
          const pendingIdentity = await tx.verificationCase.findFirst({
            where: {
              userId: user.id,
              kind: VerificationCaseKind.IDENTITY,
              status: VerificationCaseStatus.PENDING,
            },
            orderBy: { createdAt: 'desc' },
          });
          if (pendingIdentity) {
            await this.claimCase(tx, pendingIdentity, {
              status: VerificationCaseStatus.APPROVED,
              reviewedAt: now,
              reviewedById: adminId,
              userMessage: null,
              reasonCode: null,
              internalNote: dto.internalNote ?? null,
            });
          }
        }
        await this.setJobberStatus(tx, user.id, JobberStatus.ACTIVE);
      }

      // Pas d'auto-APPROVE des UserDocument : les facultatifs PENDING restent PENDING.
      // Les obligatoires doivent déjà être APPROVED (préconditions ci-dessus).

      await this.recordAdminAudit(
        adminId,
        AdminAuditAction.APPROVE_PROFILE,
        'VERIFICATION_CASE',
        verificationCase.id,
        {
          kind: verificationCase.kind,
          userId: user.id,
          internalNote: dto.internalNote ?? null,
        },
        tx,
      );
      return {
        case: serializeCaseForAdmin(await this.requireCase(tx, id)),
        email: user.email,
        firstName: user.firstName,
        kind: verificationCase.kind,
        userId: user.id,
      };
    });

    await this.notifyUserDecision({
      email: result.email,
      firstName: result.firstName,
      caseKind: result.kind,
      kind: 'approved',
    });

    if (result.kind === VerificationCaseKind.JOBBER_PROFILE) {
      await notifyJobberProfileVerified(
        this.notifications,
        result.userId,
        result.case.id,
      ).catch((error) => {
        this.logger.warn(
          `Notification in-app JOBBER_PROFILE_VERIFIED échouée: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
      await this.eligibilitySync
        .recomputeForUser(result.case.userId)
        .catch((error) => {
          this.logger.warn(
            `Échec recalcul éligibilité après approve dossier ${id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
    } else {
      // Identité seule (ex. Client) : notification identité, pas le paquet Jobber.
      await notifyIdentityVerified(
        this.notifications,
        result.userId,
        result.case.id,
      ).catch((error) => {
        this.logger.warn(
          `Notification in-app IDENTITY_VERIFIED échouée: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    return result.case;
  }

  async adminRequestChanges(
    id: string,
    adminId: string,
    dto: RequestChangesDto,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const verificationCase = await this.requireCase(tx, id);
      this.assertNotSelfReview(verificationCase.userId, adminId);
      assertCaseTransition(
        verificationCase.status,
        VerificationCaseStatus.NEEDS_CHANGES,
      );
      const user = await this.requireUser(tx, verificationCase.userId);
      const now = new Date();

      // Valide les cibles AVANT toute écriture.
      const targetDocs = await this.resolveTargets(
        tx,
        verificationCase,
        dto.targets ?? [],
      );

      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        assertIdentityTransition(
          user.identityVerificationStatus,
          IdentityVerificationStatus.NEEDS_CHANGES,
        );
      } else {
        const profile = await this.requireJobberProfile(tx, user.id);
        assertJobberTransition(profile.status, JobberStatus.NEEDS_CHANGES);
      }

      await this.claimCase(tx, verificationCase, {
        status: VerificationCaseStatus.NEEDS_CHANGES,
        reviewedAt: now,
        reviewedById: adminId,
        userMessage: dto.userMessage,
        reasonCode: dto.reasonCode,
        internalNote: dto.internalNote ?? null,
      });

      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        await this.setIdentityStatus(
          tx,
          user,
          IdentityVerificationStatus.NEEDS_CHANGES,
        );
      } else {
        await this.setJobberStatus(tx, user.id, JobberStatus.NEEDS_CHANGES);
      }

      for (const doc of targetDocs) {
        await tx.userDocument.update({
          where: { id: doc.id },
          data: {
            status: UserDocumentStatus.NEEDS_CHANGES,
            reviewedAt: now,
            reviewedById: adminId,
            reasonCode: dto.reasonCode,
            userMessage: dto.userMessage,
          },
        });
        await this.recordDocumentEvent(
          tx,
          doc.id,
          adminId,
          'CHANGES_REQUESTED',
          {
            via: 'CASE_REVIEW',
            reasonCode: dto.reasonCode,
          },
        );
      }

      await this.recordAdminAudit(
        adminId,
        AdminAuditAction.REQUEST_PROFILE_CHANGES,
        'VERIFICATION_CASE',
        verificationCase.id,
        {
          kind: verificationCase.kind,
          userId: user.id,
          reasonCode: dto.reasonCode,
          targets: targetDocs.map((d) => d.id),
          internalNote: dto.internalNote ?? null,
        },
        tx,
      );
      return {
        case: serializeCaseForAdmin(await this.requireCase(tx, id)),
        email: user.email,
        firstName: user.firstName,
        kind: verificationCase.kind,
        userId: user.id,
        userMessage: dto.userMessage,
      };
    });

    await this.notifyUserDecision({
      email: result.email,
      firstName: result.firstName,
      caseKind: result.kind,
      kind: 'needs_changes',
      userMessage: result.userMessage,
    });

    if (result.kind === VerificationCaseKind.JOBBER_PROFILE) {
      await notifyJobberNeedsChanges(
        this.notifications,
        result.userId,
        result.case.id,
        result.case.reviewedAt ?? new Date().toISOString(),
      ).catch((error) => {
        this.logger.warn(
          `Notification in-app NEEDS_CHANGES échouée: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    return result.case;
  }

  async adminRejectCase(id: string, adminId: string, dto: RejectCaseDto) {
    const result = await this.prisma.$transaction(async (tx) => {
      const verificationCase = await this.requireCase(tx, id);
      this.assertNotSelfReview(verificationCase.userId, adminId);
      assertCaseTransition(
        verificationCase.status,
        VerificationCaseStatus.REJECTED,
      );
      const user = await this.requireUser(tx, verificationCase.userId);

      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        assertIdentityTransition(
          user.identityVerificationStatus,
          IdentityVerificationStatus.REJECTED,
        );
      } else {
        const profile = await this.requireJobberProfile(tx, user.id);
        assertJobberTransition(profile.status, JobberStatus.REJECTED);
      }

      await this.claimCase(tx, verificationCase, {
        status: VerificationCaseStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedById: adminId,
        userMessage: dto.userMessage,
        reasonCode: dto.reasonCode,
        internalNote: dto.internalNote ?? null,
      });

      if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
        await this.setIdentityStatus(
          tx,
          user,
          IdentityVerificationStatus.REJECTED,
        );
      } else {
        await this.setJobberStatus(tx, user.id, JobberStatus.REJECTED);
      }

      await this.recordAdminAudit(
        adminId,
        AdminAuditAction.REJECT_PROFILE,
        'VERIFICATION_CASE',
        verificationCase.id,
        {
          kind: verificationCase.kind,
          userId: user.id,
          reasonCode: dto.reasonCode,
          internalNote: dto.internalNote ?? null,
        },
        tx,
      );
      return {
        case: serializeCaseForAdmin(await this.requireCase(tx, id)),
        email: user.email,
        firstName: user.firstName,
        kind: verificationCase.kind,
        userId: user.id,
        userMessage: dto.userMessage,
      };
    });

    await this.notifyUserDecision({
      email: result.email,
      firstName: result.firstName,
      caseKind: result.kind,
      kind: 'rejected',
      userMessage: result.userMessage,
    });

    if (result.kind === VerificationCaseKind.JOBBER_PROFILE) {
      await notifyJobberRejected(
        this.notifications,
        result.userId,
        result.case.id,
        result.userMessage,
      ).catch((error) => {
        this.logger.warn(
          `Notification in-app REJECTED échouée: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    return result.case;
  }

  // ---------------------------------------------------------------------------
  // Côté admin : documents
  // ---------------------------------------------------------------------------

  async adminListDocuments(query: AdminDocumentsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const where: Prisma.UserDocumentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.userId) where.userId = query.userId;
    if (query.documentTypeCode) {
      const type = await this.prisma.documentType.findUnique({
        where: { code: query.documentTypeCode },
      });
      where.documentTypeId = type?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const [total, docs, types] = await Promise.all([
      this.prisma.userDocument.count({ where }),
      this.prisma.userDocument.findMany({
        where,
        orderBy: { submittedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.documentType.findMany(),
    ]);
    const codeById = new Map(types.map((t) => [t.id, t.code]));

    return {
      items: docs.map((d) =>
        serializeDocumentForAdmin(
          d,
          codeById.get(d.documentTypeId) ?? 'UNKNOWN',
        ),
      ),
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async adminGetDocument(id: string) {
    const doc = await this.prisma.userDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document introuvable');
    const [type, events] = await Promise.all([
      this.prisma.documentType.findUnique({
        where: { id: doc.documentTypeId },
      }),
      this.prisma.userDocumentEvent.findMany({
        where: { documentId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return serializeDocumentForAdmin(doc, type?.code ?? 'UNKNOWN', events);
  }

  adminApproveDocument(
    id: string,
    adminId: string,
    dto: ApproveDocumentDto = {},
  ) {
    return this.reviewDocumentAndSyncEligibility(
      id,
      UserDocumentStatus.APPROVED,
      {
        adminId,
        internalNote: dto.internalNote,
      },
    );
  }

  adminRejectDocument(id: string, adminId: string, dto: RejectDocumentDto) {
    return this.reviewDocumentAndSyncEligibility(
      id,
      UserDocumentStatus.REJECTED,
      {
        adminId,
        ...dto,
      },
    );
  }

  adminRequestDocumentChanges(
    id: string,
    adminId: string,
    dto: RequestDocumentChangesDto,
  ) {
    return this.reviewDocumentAndSyncEligibility(
      id,
      UserDocumentStatus.NEEDS_CHANGES,
      {
        adminId,
        ...dto,
      },
    );
  }

  private async reviewDocumentAndSyncEligibility(
    id: string,
    target: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES',
    review: Review,
  ) {
    const serialized = await this.reviewDocument(id, target, review);
    await this.eligibilitySync
      .recomputeForUser(serialized.userId)
      .catch((error) => {
        this.logger.warn(
          `Échec recalcul éligibilité après revue document ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    return serialized;
  }

  async getCounts() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      identityPending,
      jobberProfilePending,
      needsChanges,
      documentsPending,
      recentlyApproved,
    ] = await Promise.all([
      this.prisma.verificationCase.count({
        where: {
          kind: VerificationCaseKind.IDENTITY,
          status: VerificationCaseStatus.PENDING,
        },
      }),
      this.prisma.verificationCase.count({
        where: {
          kind: VerificationCaseKind.JOBBER_PROFILE,
          status: VerificationCaseStatus.PENDING,
        },
      }),
      this.prisma.verificationCase.count({
        where: { status: VerificationCaseStatus.NEEDS_CHANGES },
      }),
      this.prisma.userDocument.count({
        where: {
          status: {
            in: [UserDocumentStatus.PENDING, UserDocumentStatus.UNDER_REVIEW],
          },
        },
      }),
      this.prisma.verificationCase.count({
        where: {
          status: VerificationCaseStatus.APPROVED,
          reviewedAt: { gte: since },
        },
      }),
    ]);
    return {
      identityPending,
      jobberProfilePending,
      needsChanges,
      documentsPending,
      recentlyApproved,
      totalPending: identityPending + jobberProfilePending,
    };
  }

  /** Journal d'audit des actions admin (immuable, jamais exposé aux utilisateurs). */
  async recordAdminAudit(
    actorId: string,
    action: AdminAuditAction,
    resourceType: string,
    resourceId: string,
    metadata?: Prisma.InputJsonObject,
    db: Db | PrismaService = this.prisma,
  ): Promise<void> {
    await db.adminAuditEvent.create({
      data: { actorId, action, resourceType, resourceId, metadata },
    });
  }

  /** Notifie l'utilisateur après décision (échec email non bloquant). */
  private async notifyUserDecision(input: {
    email: string | null;
    firstName: string;
    caseKind: VerificationCaseKind;
    kind: VerificationEmailKind;
    userMessage?: string | null;
  }): Promise<void> {
    if (!input.email) {
      this.logger.log(
        `Notification vérification (${input.kind}) ignorée : user sans email`,
      );
      return;
    }
    try {
      const content = buildVerificationDecisionEmail({
        kind: input.kind,
        firstName: input.firstName,
        caseKind: input.caseKind,
        userMessage: input.userMessage,
      });
      await this.emailService.send({
        to: input.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    } catch (error) {
      this.logger.warn(
        `Échec envoi email vérification (${input.kind}) vers ${input.email}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------------

  private async reviewDocument(
    id: string,
    target: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES',
    review: Review,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.userDocument.findUnique({ where: { id } });
      if (!doc) throw new NotFoundException('Document introuvable');
      this.assertNotSelfReview(doc.userId, review.adminId);

      const reviewable: UserDocumentStatus[] = [
        UserDocumentStatus.PENDING,
        UserDocumentStatus.UNDER_REVIEW,
      ];
      if (!reviewable.includes(doc.status)) {
        throw new BadRequestException(
          `Ce document ne peut plus être traité (statut ${doc.status}).`,
        );
      }

      const now = new Date();
      const claimed = await tx.userDocument.updateMany({
        where: { id, status: { in: reviewable } },
        data: {
          status: target,
          reviewedAt: now,
          reviewedById: review.adminId,
          reasonCode:
            target === 'APPROVED' ? null : (review.reasonCode ?? null),
          userMessage:
            target === 'APPROVED' ? null : (review.userMessage ?? null),
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Ce document vient d’être traité.');
      }

      const action =
        target === 'APPROVED'
          ? AdminAuditAction.VERIFY_DOCUMENT
          : target === 'REJECTED'
            ? AdminAuditAction.REJECT_DOCUMENT
            : AdminAuditAction.REQUEST_DOCUMENT_REPLACEMENT;
      const eventName =
        target === 'APPROVED'
          ? 'APPROVED'
          : target === 'REJECTED'
            ? 'REJECTED'
            : 'CHANGES_REQUESTED';

      await this.recordDocumentEvent(tx, id, review.adminId, eventName, {
        reasonCode: review.reasonCode ?? null,
      });
      await this.recordAdminAudit(
        review.adminId,
        action,
        'USER_DOCUMENT',
        id,
        {
          userId: doc.userId,
          reasonCode: review.reasonCode ?? null,
          internalNote: review.internalNote ?? null,
        },
        tx,
      );

      const updated = await tx.userDocument.findUnique({ where: { id } });
      const type = await tx.documentType.findUnique({
        where: { id: doc.documentTypeId },
      });
      return serializeDocumentForAdmin(updated ?? doc, type?.code ?? 'UNKNOWN');
    });
  }

  /** Crée un dossier PENDING, ou re-soumet un DRAFT / NEEDS_CHANGES existant. */
  private async openCase(
    tx: Db,
    userId: string,
    kind: VerificationCaseKind,
    now: Date,
  ): Promise<VerificationCase> {
    const existing = await tx.verificationCase.findFirst({
      where: {
        userId,
        kind,
        status: {
          in: [
            VerificationCaseStatus.DRAFT,
            VerificationCaseStatus.NEEDS_CHANGES,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
      return tx.verificationCase.create({
        data: {
          userId,
          kind,
          status: VerificationCaseStatus.PENDING,
          submittedAt: now,
        },
      });
    }

    assertCaseTransition(existing.status, VerificationCaseStatus.PENDING);
    const claimed = await tx.verificationCase.updateMany({
      where: { id: existing.id, status: existing.status },
      data: {
        status: VerificationCaseStatus.PENDING,
        submittedAt: now,
        reviewedAt: null,
        reviewedById: null,
        userMessage: null,
        reasonCode: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Ce dossier a déjà été soumis.');
    }
    return this.requireCase(tx, existing.id);
  }

  /** Verrou optimiste : une seule décision admin passe (PENDING -> état cible). */
  private async claimCase(
    tx: Db,
    verificationCase: VerificationCase,
    data: Prisma.VerificationCaseUncheckedUpdateManyInput,
  ): Promise<void> {
    const claimed = await tx.verificationCase.updateMany({
      where: { id: verificationCase.id, status: verificationCase.status },
      data,
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Ce dossier vient d’être traité.');
    }
  }

  private async setIdentityStatus(
    tx: Db,
    user: Pick<User, 'id' | 'identityVerificationStatus'>,
    to: IdentityVerificationStatus,
  ): Promise<void> {
    const claimed = await tx.user.updateMany({
      where: {
        id: user.id,
        identityVerificationStatus: user.identityVerificationStatus,
      },
      data: { identityVerificationStatus: to },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Le statut d’identité vient de changer.');
    }
  }

  private async setJobberStatus(
    tx: Db,
    userId: string,
    to: JobberStatus,
  ): Promise<void> {
    const profile = await this.requireJobberProfile(tx, userId);
    const claimed = await tx.jobberProfile.updateMany({
      where: { id: profile.id, status: profile.status },
      data: { status: to },
    });
    if (claimed.count !== 1) {
      throw new ConflictException('Le statut du profil vient de changer.');
    }
  }

  /** Cibles = identifiants de documents du dossier ou codes de type. */
  private async resolveTargets(
    tx: Db,
    verificationCase: VerificationCase,
    targets: string[],
  ): Promise<UserDocument[]> {
    if (targets.length === 0) return [];
    const documents = await this.loadDocuments(tx, verificationCase.userId);
    const candidates = documents.filter(
      (d) =>
        d.doc.verificationCaseId === verificationCase.id &&
        d.doc.status !== UserDocumentStatus.EXPIRED,
    );

    const resolved = new Map<string, UserDocument>();
    for (const target of targets) {
      const matches = candidates.filter(
        (d) =>
          d.doc.id === target || d.documentTypeCode === target.toUpperCase(),
      );
      if (matches.length === 0) {
        throw new BadRequestException(
          `Cible inconnue pour ce dossier : ${target}`,
        );
      }
      for (const match of matches) resolved.set(match.doc.id, match.doc);
    }
    return [...resolved.values()];
  }

  private assertGuardianNotBlocking(status: LegalGuardianStatus): void {
    if (
      status === LegalGuardianStatus.REQUIRED ||
      status === LegalGuardianStatus.PENDING ||
      status === LegalGuardianStatus.REJECTED
    ) {
      throw new ConflictException(
        'L’autorisation du représentant légal est requise avant validation.',
      );
    }
  }

  private assertNotSelfReview(ownerId: string, adminId: string): void {
    if (ownerId === adminId) {
      throw new ForbiddenException(
        'Vous ne pouvez pas traiter votre propre dossier.',
      );
    }
  }

  private resolveSubType(
    code: string,
    requested: IdentityDocumentSubType | null | undefined,
  ): IdentityDocumentSubType | null {
    if (code === DOCUMENT_CODES.CIP || code === DOCUMENT_CODES.PASSPORT) {
      const derived =
        code === DOCUMENT_CODES.CIP
          ? IdentityDocumentSubType.CIP
          : IdentityDocumentSubType.PASSPORT;
      if (requested && requested !== derived) {
        throw new BadRequestException(
          'identitySubType incohérent avec le type de document.',
        );
      }
      return derived;
    }
    if (code === DOCUMENT_CODES.IDENTITY_DOCUMENT) {
      return requested ?? null;
    }
    if (requested) {
      throw new BadRequestException(
        'identitySubType ne s’applique qu’aux pièces d’identité.',
      );
    }
    return null;
  }

  private resolveCapturedAt(
    code: string,
    raw: Date | string | null | undefined,
  ): Date | null {
    const now = Date.now();
    if (code !== DOCUMENT_CODES.LIVE_SELFIE) {
      return raw ? new Date(raw) : null;
    }
    if (!raw) return new Date(now);
    const capturedAt = new Date(raw);
    if (Number.isNaN(capturedAt.getTime())) {
      throw new BadRequestException('capturedAt invalide.');
    }
    const age = now - capturedAt.getTime();
    if (age > SELFIE_MAX_AGE_MS || age < -SELFIE_MAX_FUTURE_SKEW_MS) {
      throw new BadRequestException(
        'Le selfie doit être capturé en direct, juste avant l’envoi.',
      );
    }
    return capturedAt;
  }

  /**
   * Complétude affichée en liste : X/Y pièces du dossier.
   * IDENTITY = 3 emplacements obligatoires ; JOBBER = pièces rattachées au cas.
   */
  private documentsSummaryForList(
    verificationCase: VerificationCase,
    docs: Array<{
      documentTypeCode: string;
      status: UserDocumentStatus;
      caseId: string | null;
    }>,
  ): { received: number; required: number } {
    if (verificationCase.kind === VerificationCaseKind.IDENTITY) {
      const completion = this.identityCompletion.check(
        docs.map((d) => ({
          documentTypeCode: d.documentTypeCode,
          status: d.status,
        })),
      );
      const required = 3;
      const received = Math.max(0, required - completion.missing.length);
      return { received, required };
    }

    const attached = docs.filter(
      (d) =>
        d.caseId === verificationCase.id ||
        (verificationCase.status === VerificationCaseStatus.PENDING &&
          d.caseId === null &&
          !IDENTITY_CASE_DOCUMENT_CODES.includes(d.documentTypeCode)),
    );
    const usable = attached.filter((d) =>
      USABLE_DOCUMENT_STATUSES.includes(d.status),
    );
    const received = usable.length;
    return { received, required: Math.max(received, 1) };
  }

  private completionOf(
    documents: Array<{ doc: UserDocument; documentTypeCode: string }>,
  ): IdentityCompletionResult {
    const presence: DocumentPresence[] = documents.map((d) => ({
      documentTypeCode: d.documentTypeCode,
      status: d.doc.status,
    }));
    return this.identityCompletion.check(presence);
  }

  /**
   * Préconditions objectives pour APPROVE Jobber (dossier global) :
   * profil renseigné + au moins un service.
   * Les ServiceRequirements DOCUMENT affectent l'éligibilité **par service**,
   * pas la validation globale du profil.
   */
  private async assertJobberCaseReadyForApproval(
    db: Db | PrismaService,
    jobberProfileId: string,
  ): Promise<void> {
    const profile = await db.jobberProfile.findUnique({
      where: { id: jobberProfileId },
    });
    if (!profile) {
      throw new NotFoundException('Profil Jobber introuvable');
    }
    if (!profile.bio?.trim()) {
      throw new BadRequestException(
        'Impossible de valider : la description professionnelle est manquante.',
      );
    }

    const jobberServices = await db.jobberService.findMany({
      where: { jobberProfileId },
    });
    if (jobberServices.length === 0) {
      throw new BadRequestException(
        'Impossible de valider : aucun service n’est configuré sur le profil.',
      );
    }
  }

  /** Codes DocumentType rendus obligatoires via ServiceRequirement pour les services du Jobber. */
  private async resolveDocumentRequirements(
    db: Db | PrismaService,
    verificationCase: VerificationCase,
  ): Promise<Map<string, { serviceName: string }>> {
    const result = new Map<string, { serviceName: string }>();
    if (verificationCase.kind !== VerificationCaseKind.JOBBER_PROFILE) {
      return result;
    }
    const profile = await db.jobberProfile.findUnique({
      where: { userId: verificationCase.userId },
    });
    if (!profile) return result;

    const jobberServices = await db.jobberService.findMany({
      where: { jobberProfileId: profile.id },
    });
    const serviceIds = jobberServices.map((js) => js.serviceId);
    if (serviceIds.length === 0) return result;

    const [requirements, services] = await Promise.all([
      db.serviceRequirement.findMany({
        where: {
          serviceId: { in: serviceIds },
          isActive: true,
          isRequired: true,
          type: ServiceRequirementType.DOCUMENT,
        },
      }),
      db.service.findMany({ where: { id: { in: serviceIds } } }),
    ]);
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]));
    const typeIds = requirements
      .map((r) => r.documentTypeId)
      .filter((id): id is string => Boolean(id));
    const types =
      typeIds.length > 0
        ? await db.documentType.findMany({ where: { id: { in: typeIds } } })
        : [];
    const codeById = new Map(types.map((t) => [t.id, t.code]));

    for (const req of requirements) {
      if (!req.documentTypeId) continue;
      const code = codeById.get(req.documentTypeId);
      if (!code) continue;
      result.set(code, {
        serviceName: serviceNameById.get(req.serviceId) ?? 'service',
      });
    }
    return result;
  }

  private requirementMetaFor(
    kind: VerificationCaseKind,
    documentTypeCode: string,
    requirementByCode: Map<string, { serviceName: string }>,
  ): DocumentRequirementMeta {
    if (kind === VerificationCaseKind.IDENTITY) {
      if (IDENTITY_CASE_DOCUMENT_CODES.includes(documentTypeCode)) {
        return {
          mandatory: true,
          label: 'Obligatoire',
          requiredForService: null,
        };
      }
      return {
        mandatory: false,
        label: 'Facultatif',
        requiredForService: null,
      };
    }

    if (IDENTITY_CASE_DOCUMENT_CODES.includes(documentTypeCode)) {
      return {
        mandatory: true,
        label: 'Obligatoire',
        requiredForService: null,
      };
    }

    const req = requirementByCode.get(documentTypeCode);
    if (req) {
      return {
        mandatory: true,
        label: 'Obligatoire',
        requiredForService: `Exigé pour ${req.serviceName}`,
      };
    }
    return {
      mandatory: false,
      label: 'Facultatif',
      requiredForService: null,
    };
  }

  private async loadDocuments(
    db: Db | PrismaService,
    userId: string,
  ): Promise<Array<{ doc: UserDocument; documentTypeCode: string }>> {
    const [docs, types] = await Promise.all([
      db.userDocument.findMany({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
      }),
      db.documentType.findMany(),
    ]);
    const codeById = new Map<string, string>(
      types.map((t: Pick<DocumentType, 'id' | 'code'>) => [t.id, t.code]),
    );
    return docs.map((doc) => ({
      doc,
      documentTypeCode: codeById.get(doc.documentTypeId) ?? 'UNKNOWN',
    }));
  }

  private latestCase(
    db: Db | PrismaService,
    userId: string,
    kind: VerificationCaseKind,
  ) {
    return db.verificationCase.findFirst({
      where: { userId, kind },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recordDocumentEvent(
    db: Db | PrismaService,
    documentId: string,
    actorId: string | null,
    action: string,
    metadata?: Prisma.InputJsonObject,
  ): Promise<void> {
    await db.userDocumentEvent.create({
      data: { documentId, actorId, action, metadata },
    });
  }

  private async requireUser(db: Db | PrismaService, userId: string) {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  private async requireCase(db: Db | PrismaService, id: string) {
    const verificationCase = await db.verificationCase.findUnique({
      where: { id },
    });
    if (!verificationCase) throw new NotFoundException('Dossier introuvable');
    return verificationCase;
  }

  private async requireJobberProfile(db: Db | PrismaService, userId: string) {
    const profile = await db.jobberProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profil Jobber introuvable');
    return profile;
  }
}
