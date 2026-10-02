import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminAuditAction,
  IdentityVerificationStatus,
  JobberStatus,
  LegalGuardianStatus,
  UserDocumentStatus,
  UserRole,
  VerificationCaseKind,
  VerificationCaseStatus,
} from '@prisma/client';
import { InMemoryPrisma } from '../../../test/support/in-memory-prisma';
import { createUser } from '../../../test/support/mission-fixtures';
import { InMemoryStorageProvider } from '../../infrastructure/storage/in-memory-storage.provider';
import { IdentityCompletionService } from './identity-completion.service';
import { VerificationsService } from './verifications.service';

const jpeg = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const pdf = () => Buffer.from('%PDF-1.4\n' + 'x'.repeat(64));

describe('VerificationsService', () => {
  let db: InMemoryPrisma;
  let storage: InMemoryStorageProvider;
  let service: VerificationsService;
  let user: { id: string };
  let admin: { id: string };

  const upload = (
    userId: string,
    documentTypeCode: string,
    overrides: Partial<{ mimeType: string; fileBuffer: Buffer }> = {},
  ) =>
    service.createDocument(userId, {
      documentTypeCode,
      mimeType: 'image/jpeg',
      fileBuffer: jpeg(),
      ...overrides,
    });

  const uploadAll = async (userId: string) => {
    const cip = await upload(userId, 'CIP');
    const residence = await upload(userId, 'RESIDENCE_CERTIFICATE', {
      mimeType: 'application/pdf',
      fileBuffer: pdf(),
    });
    const selfie = await upload(userId, 'LIVE_SELFIE');
    return { cip, residence, selfie };
  };

  const userRow = (id: string) => db.user.rows.find((u) => u.id === id)!;
  const docRow = (id: string) => db.userDocument.rows.find((d) => d.id === id)!;

  const submitComplete = async () => {
    const docs = await uploadAll(user.id);
    const verificationCase = await service.submitIdentity(user.id);
    return { docs, verificationCase };
  };

  /** Approuve individuellement les pièces d'identité obligatoires (préalable à APPROVE dossier). */
  const approveIdentityDocs = async (docs: {
    cip: { id: string };
    residence: { id: string };
    selfie: { id: string };
  }) => {
    await service.adminApproveDocument(docs.cip.id, admin.id);
    await service.adminApproveDocument(docs.residence.id, admin.id);
    await service.adminApproveDocument(docs.selfie.id, admin.id);
  };

  beforeEach(async () => {
    db = new InMemoryPrisma();
    storage = new InMemoryStorageProvider();
    service = new VerificationsService(
      db.asPrismaService(),
      storage,
      new IdentityCompletionService(),
      { send: jest.fn().mockResolvedValue(undefined) } as never,
      {
        get: (key: string) =>
          key === 'storage'
            ? { maxUploadBytes: 8 * 1024 * 1024, signedUrlTtlSeconds: 180 }
            : undefined,
      } as never,
      {
        recomputeForUser: jest.fn().mockResolvedValue(undefined),
        loadApprovedDocumentTypeIds: jest
          .fn()
          .mockResolvedValue(new Set()),
        getDocumentRequirementsSummary: jest.fn(),
      } as never,
      {
        createIfAbsent: jest.fn().mockResolvedValue(null),
        listForUser: jest.fn(),
        unreadCount: jest.fn(),
        markRead: jest.fn(),
        markAllRead: jest.fn(),
      } as never,
    );
    for (const code of [
      'IDENTITY_DOCUMENT',
      'CIP',
      'PASSPORT',
      'RESIDENCE_CERTIFICATE',
      'LIVE_SELFIE',
      'CV',
    ]) {
      await db.documentType.create({ data: { code, name: code } });
    }
    user = await createUser(db, {
      identityVerificationStatus: IdentityVerificationStatus.UNVERIFIED,
    });
    admin = await createUser(db, { role: UserRole.ADMIN });
  });

  describe('createDocument', () => {
    it('stores the file privately and never returns the storage key', async () => {
      const doc = await upload(user.id, 'CIP');
      expect(doc).toMatchObject({
        documentTypeCode: 'CIP',
        identitySubType: 'CIP',
        status: UserDocumentStatus.PENDING,
      });
      expect(JSON.stringify(doc)).not.toContain('storageKey');
      expect(storage.files.size).toBe(1);
      expect(docRow(doc.id).storageKey).toBe([...storage.files.keys()][0]);
    });

    it('rejects unsupported MIME types and mismatching content', async () => {
      await expect(
        upload(user.id, 'CIP', { mimeType: 'text/html' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        upload(user.id, 'CIP', { mimeType: 'image/png' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.files.size).toBe(0);
    });

    it('requires the live selfie to be an image', async () => {
      await expect(
        upload(user.id, 'LIVE_SELFIE', {
          mimeType: 'application/pdf',
          fileBuffer: pdf(),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a stale selfie capture date', async () => {
      await expect(
        service.createDocument(user.id, {
          documentTypeCode: 'LIVE_SELFIE',
          mimeType: 'image/jpeg',
          fileBuffer: jpeg(),
          capturedAt: new Date(Date.now() - 24 * 3600 * 1000),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('replaces a previous non-approved upload of the same type', async () => {
      const first = await upload(user.id, 'CIP');
      const second = await upload(user.id, 'CIP');
      expect(docRow(first.id).status).toBe(UserDocumentStatus.EXPIRED);
      expect(docRow(second.id).status).toBe(UserDocumentStatus.PENDING);
    });

    it('freezes identity documents while the case is under review', async () => {
      await submitComplete();
      await expect(upload(user.id, 'CIP')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('submitIdentity', () => {
    it('refuses an incomplete dossier and lists what is missing', async () => {
      await upload(user.id, 'CIP');
      const error = await service.submitIdentity(user.id).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().missing).toEqual([
        'RESIDENCE_CERTIFICATE',
        'LIVE_SELFIE',
      ]);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.UNVERIFIED,
      );
      expect(db.verificationCase.rows).toHaveLength(0);
    });

    it('accepts a passport instead of a CIP', async () => {
      await upload(user.id, 'PASSPORT');
      await upload(user.id, 'RESIDENCE_CERTIFICATE');
      await upload(user.id, 'LIVE_SELFIE');
      const result = await service.submitIdentity(user.id);
      expect(result.status).toBe(VerificationCaseStatus.PENDING);
    });

    it('creates a PENDING case, moves the user to PENDING and attaches documents', async () => {
      const { docs, verificationCase } = await submitComplete();
      expect(verificationCase).toMatchObject({
        kind: VerificationCaseKind.IDENTITY,
        status: VerificationCaseStatus.PENDING,
      });
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.PENDING,
      );
      for (const doc of Object.values(docs)) {
        expect(docRow(doc.id).verificationCaseId).toBe(verificationCase.id);
      }
    });

    it('cannot be submitted twice', async () => {
      await submitComplete();
      await expect(service.submitIdentity(user.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(db.verificationCase.rows).toHaveLength(1);
    });
  });

  describe('adminApproveCase', () => {
    it('A: refuses APPROVE while a mandatory document is still PENDING', async () => {
      const { verificationCase } = await submitComplete();
      await expect(
        service.adminApproveCase(verificationCase.id, admin.id),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.PENDING,
      );
    });

    it('approves identity only after mandatory docs are APPROVED and writes an audit event', async () => {
      const { docs, verificationCase } = await submitComplete();
      await approveIdentityDocs(docs);

      const result = await service.adminApproveCase(
        verificationCase.id,
        admin.id,
        { internalNote: 'RAS' },
      );

      expect(result.status).toBe(VerificationCaseStatus.APPROVED);
      expect(result.reviewedById).toBe(admin.id);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.VERIFIED,
      );
      for (const doc of Object.values(docs)) {
        expect(docRow(doc.id).status).toBe(UserDocumentStatus.APPROVED);
      }
      expect(db.adminAuditEvent.rows).toHaveLength(4); // 3 doc + 1 case
      expect(
        db.adminAuditEvent.rows.some(
          (e) => e.action === AdminAuditAction.APPROVE_PROFILE,
        ),
      ).toBe(true);
    });

    it('rejects a double approve', async () => {
      const { docs, verificationCase } = await submitComplete();
      await approveIdentityDocs(docs);
      await service.adminApproveCase(verificationCase.id, admin.id);
      await expect(
        service.adminApproveCase(verificationCase.id, admin.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([LegalGuardianStatus.REQUIRED, LegalGuardianStatus.PENDING])(
      'is blocked while the legal guardian status is %s',
      async (guardian) => {
        const { docs, verificationCase } = await submitComplete();
        await approveIdentityDocs(docs);
        await db.user.update({
          where: { id: user.id },
          data: { legalGuardianStatus: guardian },
        });

        await expect(
          service.adminApproveCase(verificationCase.id, admin.id),
        ).rejects.toBeInstanceOf(ConflictException);

        expect(userRow(user.id).identityVerificationStatus).toBe(
          IdentityVerificationStatus.PENDING,
        );
        expect(db.verificationCase.rows[0].status).toBe(
          VerificationCaseStatus.PENDING,
        );
      },
    );

    it('can proceed once the guardian has approved', async () => {
      const { docs, verificationCase } = await submitComplete();
      await approveIdentityDocs(docs);
      await db.user.update({
        where: { id: user.id },
        data: { legalGuardianStatus: LegalGuardianStatus.APPROVED },
      });
      await expect(
        service.adminApproveCase(verificationCase.id, admin.id),
      ).resolves.toMatchObject({ status: VerificationCaseStatus.APPROVED });
    });

    it('refuses to approve when a required document was rejected meanwhile', async () => {
      const { docs, verificationCase } = await submitComplete();
      await service.adminApproveDocument(docs.cip.id, admin.id);
      await service.adminApproveDocument(docs.residence.id, admin.id);
      await service.adminRejectDocument(docs.selfie.id, admin.id, {
        userMessage: 'Photo floue',
        reasonCode: 'DOCUMENT_UNREADABLE',
      });
      await expect(
        service.adminApproveCase(verificationCase.id, admin.id),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.PENDING,
      );
    });

    it('forbids an admin from reviewing their own dossier', async () => {
      const own = await createUser(db, {
        role: UserRole.ADMIN,
        identityVerificationStatus: IdentityVerificationStatus.UNVERIFIED,
      });
      await uploadAll(own.id);
      const verificationCase = await service.submitIdentity(own.id);
      await expect(
        service.adminApproveCase(verificationCase.id, own.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s on an unknown case', async () => {
      await expect(
        service.adminApproveCase(randomUUID(), admin.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('B+C: JOBBER APPROVE allowed with optional CV/DIPLOMA PENDING; they stay PENDING', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      const profile = await db.jobberProfile.create({
        data: {
          userId: user.id,
          status: JobberStatus.DRAFT,
          bio: 'Plombier de démonstration',
          headline: 'Plomberie',
        },
      });
      const category = await db.serviceCategory.create({
        data: { name: 'Travaux', slug: 'travaux-demo', isActive: true },
      });
      const plumbing = await db.service.create({
        data: {
          categoryId: category.id,
          name: 'Plomberie',
          slug: 'plomberie-demo',
          isActive: true,
          minimumAge: 16,
        },
      });
      await db.jobberService.create({
        data: {
          jobberProfileId: profile.id,
          serviceId: plumbing.id,
          status: 'PENDING_ELIGIBILITY',
        },
      });
      await db.documentType.create({ data: { code: 'DIPLOMA', name: 'Diplôme' } });
      const cv = await upload(user.id, 'CV', {
        mimeType: 'application/pdf',
        fileBuffer: pdf(),
      });
      const diploma = await upload(user.id, 'DIPLOMA', {
        mimeType: 'application/pdf',
        fileBuffer: pdf(),
      });
      const verificationCase = await service.submitJobberProfile(user.id);
      expect(docRow(cv.id).status).toBe(UserDocumentStatus.PENDING);
      expect(docRow(diploma.id).status).toBe(UserDocumentStatus.PENDING);

      const result = await service.adminApproveCase(
        verificationCase.id,
        admin.id,
      );
      expect(result.status).toBe(VerificationCaseStatus.APPROVED);
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.ACTIVE);
      expect(docRow(cv.id).status).toBe(UserDocumentStatus.PENDING);
      expect(docRow(diploma.id).status).toBe(UserDocumentStatus.PENDING);
    });

    it('D: ServiceRequirement DOCUMENT PENDING does not block JOBBER profile APPROVE', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      const profile = await db.jobberProfile.create({
        data: {
          userId: user.id,
          status: JobberStatus.DRAFT,
          bio: 'Profil avec certification exigée pour un service',
        },
      });
      const category = await db.serviceCategory.create({
        data: { name: 'Travaux', slug: 'travaux-req', isActive: true },
      });
      const plumbing = await db.service.create({
        data: {
          categoryId: category.id,
          name: 'Plomberie',
          slug: 'plomberie-req',
          isActive: true,
          minimumAge: 16,
        },
      });
      await db.jobberService.create({
        data: {
          jobberProfileId: profile.id,
          serviceId: plumbing.id,
          status: 'PENDING_ELIGIBILITY',
        },
      });
      const certType = await db.documentType.create({
        data: { code: 'CERTIFICATE', name: 'Certificat' },
      });
      await db.serviceRequirement.create({
        data: {
          serviceId: plumbing.id,
          type: 'DOCUMENT',
          code: 'CERT_PLOMBERIE',
          label: 'Certification plomberie',
          isRequired: true,
          isActive: true,
          documentTypeId: certType.id,
        },
      });
      const cert = await upload(user.id, 'CERTIFICATE', {
        mimeType: 'application/pdf',
        fileBuffer: pdf(),
      });
      const verificationCase = await service.submitJobberProfile(user.id);
      expect(docRow(cert.id).status).toBe(UserDocumentStatus.PENDING);

      // Dossier global validable ; l'éligibilité Plomberie reste bloquée ailleurs.
      const result = await service.adminApproveCase(
        verificationCase.id,
        admin.id,
      );
      expect(result.status).toBe(VerificationCaseStatus.APPROVED);
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.ACTIVE);
      expect(docRow(cert.id).status).toBe(UserDocumentStatus.PENDING);
    });

    it('E: optional docs stay PENDING after JOBBER APPROVE; required service docs are orthogonal', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      const profile = await db.jobberProfile.create({
        data: {
          userId: user.id,
          status: JobberStatus.DRAFT,
          bio: 'Profil certification OK',
        },
      });
      const category = await db.serviceCategory.create({
        data: { name: 'Travaux', slug: 'travaux-ok', isActive: true },
      });
      const plumbing = await db.service.create({
        data: {
          categoryId: category.id,
          name: 'Plomberie',
          slug: 'plomberie-ok',
          isActive: true,
          minimumAge: 16,
        },
      });
      await db.jobberService.create({
        data: {
          jobberProfileId: profile.id,
          serviceId: plumbing.id,
          status: 'PENDING_ELIGIBILITY',
        },
      });
      await db.documentType.create({
        data: { code: 'DIPLOMA', name: 'Diplôme' },
      });
      const diploma = await upload(user.id, 'DIPLOMA', {
        mimeType: 'application/pdf',
        fileBuffer: pdf(),
      });
      const verificationCase = await service.submitJobberProfile(user.id);

      const result = await service.adminApproveCase(
        verificationCase.id,
        admin.id,
      );
      expect(result.status).toBe(VerificationCaseStatus.APPROVED);
      expect(docRow(diploma.id).status).toBe(UserDocumentStatus.PENDING);
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.ACTIVE);
    });
  });

  describe('adminRequestChanges', () => {
    it('moves everything to NEEDS_CHANGES, flags targeted documents and allows resubmission', async () => {
      const { docs, verificationCase } = await submitComplete();

      const result = await service.adminRequestChanges(
        verificationCase.id,
        admin.id,
        {
          userMessage: 'Selfie illisible',
          reasonCode: 'SELFIE_UNREADABLE',
          targets: ['LIVE_SELFIE'],
          internalNote: 'doute sur la photo',
        },
      );

      expect(result.status).toBe(VerificationCaseStatus.NEEDS_CHANGES);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.NEEDS_CHANGES,
      );
      expect(docRow(docs.selfie.id)).toMatchObject({
        status: UserDocumentStatus.NEEDS_CHANGES,
        userMessage: 'Selfie illisible',
      });
      expect(docRow(docs.cip.id).status).toBe(UserDocumentStatus.PENDING);
      expect(db.adminAuditEvent.rows[0].action).toBe(
        AdminAuditAction.REQUEST_PROFILE_CHANGES,
      );

      // Le dossier est incomplet tant que le selfie n'est pas remplacé.
      await expect(service.submitIdentity(user.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await upload(user.id, 'LIVE_SELFIE');
      const resubmitted = await service.submitIdentity(user.id);
      expect(resubmitted.id).toBe(verificationCase.id);
      expect(resubmitted.status).toBe(VerificationCaseStatus.PENDING);
      expect(resubmitted.userMessage).toBeNull();
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.PENDING,
      );
    });

    it('rejects unknown targets without writing anything', async () => {
      const { verificationCase } = await submitComplete();
      await expect(
        service.adminRequestChanges(verificationCase.id, admin.id, {
          userMessage: 'x',
          reasonCode: 'OTHER',
          targets: ['CV'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(db.verificationCase.rows[0].status).toBe(
        VerificationCaseStatus.PENDING,
      );
    });
  });

  describe('adminRejectCase', () => {
    it('rejects the dossier and blocks automatic re-approval', async () => {
      const { verificationCase } = await submitComplete();

      const result = await service.adminRejectCase(
        verificationCase.id,
        admin.id,
        {
          userMessage: 'Pièce non conforme',
          reasonCode: 'DOCUMENT_INVALID',
          internalNote: 'faux suspecté',
        },
      );

      expect(result.status).toBe(VerificationCaseStatus.REJECTED);
      expect(userRow(user.id).identityVerificationStatus).toBe(
        IdentityVerificationStatus.REJECTED,
      );
      expect(db.adminAuditEvent.rows[0].action).toBe(
        AdminAuditAction.REJECT_PROFILE,
      );
      await expect(
        service.adminApproveCase(verificationCase.id, admin.id),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.submitIdentity(user.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('privacy of user responses', () => {
    it('never exposes internal notes, storage keys or reviewer ids to the user', async () => {
      const { docs, verificationCase } = await submitComplete();
      await service.adminRequestChanges(verificationCase.id, admin.id, {
        userMessage: 'Merci de corriger',
        reasonCode: 'OTHER',
        internalNote: 'SECRET-INTERNE',
        targets: [docs.cip.id],
      });

      const mine = JSON.stringify(await service.getMyVerification(user.id));
      expect(mine).toContain('Merci de corriger');
      expect(mine).not.toContain('SECRET-INTERNE');
      expect(mine).not.toContain('storageKey');
      expect(mine).not.toContain(admin.id);
      for (const key of storage.files.keys()) {
        expect(mine).not.toContain(key);
      }

      const adminView = await service.adminGetCase(verificationCase.id);
      expect(adminView.case.internalNote).toBe('SECRET-INTERNE');
      expect(JSON.stringify(adminView)).not.toContain('storageKey');
      expect(adminView.documents.length).toBeGreaterThan(0);
    });
  });

  describe('document content authorization', () => {
    it('serves the owner and admins, hides the document from others', async () => {
      const doc = await upload(user.id, 'CIP');
      const stranger = await createUser(db);

      const own = await service.getDocumentContent(
        { id: user.id, role: UserRole.USER },
        doc.id,
      );
      expect(own.mimeType).toBe('image/jpeg');

      await expect(
        service.getDocumentContent(
          { id: stranger.id, role: UserRole.USER },
          doc.id,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);

      await service.getDocumentContent(
        { id: admin.id, role: UserRole.ADMIN },
        doc.id,
      );
      expect(
        db.userDocumentEvent.rows.some((e) => e.action === 'ADMIN_VIEWED'),
      ).toBe(true);
    });
  });

  describe('document review', () => {
    it('approves, rejects and requests changes with audit trail; no double review', async () => {
      const a = await upload(user.id, 'CIP');
      const b = await upload(user.id, 'LIVE_SELFIE');
      const c = await upload(user.id, 'RESIDENCE_CERTIFICATE');

      await service.adminApproveDocument(a.id, admin.id);
      await service.adminRejectDocument(b.id, admin.id, {
        userMessage: 'Flou',
        reasonCode: 'BLURRY',
      });
      await service.adminRequestDocumentChanges(c.id, admin.id, {
        userMessage: 'Mauvais document',
        reasonCode: 'WRONG_DOCUMENT',
      });

      expect(docRow(a.id).status).toBe(UserDocumentStatus.APPROVED);
      expect(docRow(b.id).status).toBe(UserDocumentStatus.REJECTED);
      expect(docRow(c.id).status).toBe(UserDocumentStatus.NEEDS_CHANGES);
      expect(db.adminAuditEvent.rows.map((e) => e.action)).toEqual([
        AdminAuditAction.VERIFY_DOCUMENT,
        AdminAuditAction.REJECT_DOCUMENT,
        AdminAuditAction.REQUEST_DOCUMENT_REPLACEMENT,
      ]);
      await expect(
        service.adminApproveDocument(a.id, admin.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('submitJobberProfile', () => {
    const makeReadyJobber = async (userId: string, status: JobberStatus) => {
      const profile = await db.jobberProfile.create({
        data: {
          userId,
          status,
          bio: 'Travaux de plomberie et petits dépannages.',
          headline: 'Plomberie',
        },
      });
      let category = db.serviceCategory.rows.find((c) => c.slug === 'travaux');
      if (!category) {
        category = await db.serviceCategory.create({
          data: { name: 'Travaux', slug: 'travaux', isActive: true },
        });
      }
      let plumbing = db.service.rows.find((s) => s.slug === 'plomberie');
      if (!plumbing) {
        plumbing = await db.service.create({
          data: {
            categoryId: category.id,
            name: 'Plomberie',
            slug: 'plomberie',
            isActive: true,
            minimumAge: 16,
          },
        });
      }
      await db.jobberService.create({
        data: {
          jobberProfileId: profile.id,
          serviceId: plumbing.id,
          status: 'PENDING_ELIGIBILITY',
        },
      });
      return profile;
    };

    it('soumet identité + Jobber en une fois si identité non vérifiée', async () => {
      await uploadAll(user.id);
      await makeReadyJobber(user.id, JobberStatus.DRAFT);

      const verificationCase = await service.submitJobberProfile(user.id);
      expect(verificationCase).toMatchObject({
        kind: VerificationCaseKind.JOBBER_PROFILE,
        status: VerificationCaseStatus.PENDING,
      });
      expect(db.user.rows.find((u) => u.id === user.id)?.identityVerificationStatus).toBe(
        IdentityVerificationStatus.PENDING,
      );
      expect(db.jobberProfile.rows[0].status).toBe(
        JobberStatus.PENDING_VERIFICATION,
      );
      expect(
        db.verificationCase.rows.some(
          (c) =>
            c.userId === user.id &&
            c.kind === VerificationCaseKind.IDENTITY &&
            c.status === VerificationCaseStatus.PENDING,
        ),
      ).toBe(true);
    });

    it('refuse un dossier identité incomplet', async () => {
      await makeReadyJobber(user.id, JobberStatus.DRAFT);
      await expect(service.submitJobberProfile(user.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('submits and is activated by the admin', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      await makeReadyJobber(user.id, JobberStatus.DRAFT);

      const verificationCase = await service.submitJobberProfile(user.id);
      expect(verificationCase).toMatchObject({
        kind: VerificationCaseKind.JOBBER_PROFILE,
        status: VerificationCaseStatus.PENDING,
      });
      expect(db.jobberProfile.rows[0].status).toBe(
        JobberStatus.PENDING_VERIFICATION,
      );
      await expect(service.submitJobberProfile(user.id)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      await service.adminApproveCase(verificationCase.id, admin.id);
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.ACTIVE);
    });

    it('valide identité + Jobber d un coup si identité encore PENDING', async () => {
      const docs = await uploadAll(user.id);
      await makeReadyJobber(user.id, JobberStatus.DRAFT);
      const verificationCase = await service.submitJobberProfile(user.id);

      await approveIdentityDocs(docs);

      await service.adminApproveCase(verificationCase.id, admin.id);
      expect(db.user.rows.find((u) => u.id === user.id)?.identityVerificationStatus).toBe(
        IdentityVerificationStatus.VERIFIED,
      );
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.ACTIVE);
      expect(
        db.verificationCase.rows
          .filter((c) => c.userId === user.id && c.kind === VerificationCaseKind.IDENTITY)
          .every((c) => c.status === VerificationCaseStatus.APPROVED),
      ).toBe(true);
    });

    it('goes through NEEDS_CHANGES and back', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      await makeReadyJobber(user.id, JobberStatus.DRAFT);
      const verificationCase = await service.submitJobberProfile(user.id);

      await service.adminRequestChanges(verificationCase.id, admin.id, {
        userMessage: 'Complétez votre bio',
        reasonCode: 'BIO_INCOMPLETE',
      });
      expect(db.jobberProfile.rows[0].status).toBe(JobberStatus.NEEDS_CHANGES);

      const again = await service.submitJobberProfile(user.id);
      expect(again.id).toBe(verificationCase.id);
      expect(db.jobberProfile.rows[0].status).toBe(
        JobberStatus.PENDING_VERIFICATION,
      );
    });
  });

  describe('profile and counts', () => {
    it('replaces languages (deduplicated) and updates the address', async () => {
      await service.updateMyProfile(user.id, {
        addressLine: '12 rue des Cocotiers',
        city: 'Cotonou',
        countryCode: 'bj',
        languages: [
          { code: 'fr', label: 'Français' },
          { code: 'FR', label: 'Doublon' },
          { code: 'fon', label: 'Fon' },
        ],
      });
      const profile = await service.updateMyProfile(user.id, {
        languages: [{ code: 'en', label: 'Anglais' }],
      });
      expect(profile).toMatchObject({
        addressLine: '12 rue des Cocotiers',
        city: 'Cotonou',
        countryCode: 'BJ',
        languages: [{ code: 'en', label: 'Anglais' }],
      });
    });

    it('counts dossiers (VerificationCase), not documents as primary KPI', async () => {
      await submitComplete();
      const counts = await service.getCounts();
      // 1 dossier IDENTITY + 3 UserDocuments → KPI opérationnel = 1 dossier
      expect(counts.totalPending).toBe(1);
      expect(counts.identityPending).toBe(1);
      expect(counts.jobberProfilePending).toBe(0);
      expect(counts.needsChanges).toBe(0);
      // documentsPending reste disponible comme métrique secondaire technique
      expect(counts.documentsPending).toBe(3);
    });

    it('Koffi: 1 JOBBER_PROFILE + 5 UserDocuments = 1 dossier à vérifier', async () => {
      await db.user.update({
        where: { id: user.id },
        data: {
          firstName: 'Koffi',
          lastName: 'A.',
          identityVerificationStatus: IdentityVerificationStatus.VERIFIED,
        },
      });
      await db.jobberProfile.create({
        data: { userId: user.id, status: JobberStatus.DRAFT },
      });
      for (const code of ['DIPLOMA', 'CERTIFICATE', 'OTHER_PROOF', 'SERVICE_PROOF']) {
        await db.documentType.create({ data: { code, name: code } });
      }
      // 5 pièces pro rattachées au même dossier Jobber (pas 5 dossiers)
      for (const code of [
        'CV',
        'DIPLOMA',
        'CERTIFICATE',
        'OTHER_PROOF',
        'SERVICE_PROOF',
      ]) {
        await upload(user.id, code, {
          mimeType: 'application/pdf',
          fileBuffer: pdf(),
        });
      }

      await service.submitJobberProfile(user.id);
      const counts = await service.getCounts();
      expect(counts.totalPending).toBe(1);
      expect(counts.jobberProfilePending).toBe(1);
      expect(counts.identityPending).toBe(0);
      expect(counts.documentsPending).toBe(5);

      const list = await service.adminListCases({
        kind: VerificationCaseKind.JOBBER_PROFILE,
        status: VerificationCaseStatus.PENDING,
      });
      expect(list.total).toBe(1);
      expect(list.items).toHaveLength(1);
      expect(list.items[0].documentsSummary).toEqual({
        received: 5,
        required: 5,
      });

      const caseId = list.items[0].id;
      const attached = db.userDocument.rows.filter(
        (d) => d.verificationCaseId === caseId,
      );
      expect(attached).toHaveLength(5);
    });
  });
});
