/**
 * Seed DÉMONSTRATION BO03 — 2 dossiers Vérifications (Client Aïcha + Jobber Junior).
 *
 * UNIQUEMENT local / development / test.
 * Interdit en production (guard DATABASE_ENV + assertActionAllowed('seed-demo')).
 *
 * Commande : npm run db:seed:demo:verifications
 */
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  assertActionAllowed,
  buildSafetyContextFromEnv,
  DbSafetyError,
} from '../src/common/db/db-safety';
import { hashPassword } from '../src/common/utils/password';
import { normalizeEmail } from '../src/common/utils/email-normalize';
import { LocalPrivateStorageProvider } from '../src/infrastructure/storage/local-private-storage.provider';

export const DEMO_CLIENT_EMAIL = 'aicha.client.demo@kingjobs.test';
export const DEMO_JOBBER_EMAIL = 'junior.jobber.demo@kingjobs.test';

const DEMO_PASSWORD = 'Demo!KingJobs-NotReal';
const DEMO_MARK = 'DOCUMENT DE DÉMONSTRATION — AUCUNE VALEUR OFFICIELLE';

/** JPEG minimal (1x1) + commentaire DEMO dans le buffer (viewer / magic bytes). */
function demoJpegBuffer(label: string): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const comment = Buffer.from(`\n${DEMO_MARK}\n${label}\n`, 'utf8');
  const sof = Buffer.from([
    0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(0x08), 0xff, 0xc0, 0x00,
    0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xc4,
    0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7f, 0xff, 0xd9,
  ]);
  return Buffer.concat([header, comment, sof]);
}

/** PDF factice clairement marqué DEMO (pas un document officiel). */
function demoPdfBuffer(label: string): Buffer {
  const body = [
    '%PDF-1.4',
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj',
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj',
    `4 0 obj<< /Length 120 >>stream`,
    `BT /F1 10 Tf 20 150 Td (${DEMO_MARK}) Tj 0 -20 Td (${label}) Tj ET`,
    'endstream endobj',
    'xref',
    '0 6',
    'trailer<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '0',
    '%%EOF',
  ].join('\n');
  return Buffer.from(body, 'utf8');
}

function yearsAgo(years: number, month = 3, day = 15): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, month - 1, day));
}

async function requireDocumentType(
  prisma: PrismaClient,
  code: string,
): Promise<{ id: string; code: string }> {
  const row = await prisma.documentType.findUnique({ where: { code } });
  if (!row) {
    throw new Error(
      `DocumentType ${code} introuvable. Lancez d'abord npm run db:seed (catalogue).`,
    );
  }
  return row;
}

async function upsertDemoUser(
  prisma: PrismaClient,
  input: {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date;
    city: string;
    addressLine: string;
    identityVerificationStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED';
  },
) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const emailNormalized = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({
    where: { emailNormalized },
  });
  const data = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    emailNormalized,
    phone: input.phone,
    passwordHash,
    dateOfBirth: input.dateOfBirth,
    status: 'ACTIVE' as const,
    role: 'USER' as const,
    legalGuardianStatus: 'NOT_REQUIRED' as const,
    identityVerificationStatus: input.identityVerificationStatus,
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
    countryCode: 'BJ',
    city: input.city,
    addressLine: input.addressLine,
    administrativeArea: 'Littoral (démo)',
  };
  if (existing) {
    return prisma.user.update({ where: { id: existing.id }, data });
  }
  return prisma.user.create({
    data: { id: randomUUID(), ...data },
  });
}

async function replaceLanguages(
  prisma: PrismaClient,
  userId: string,
  languages: Array<{ code: string; label: string }>,
) {
  await prisma.userLanguage.deleteMany({ where: { userId } });
  if (languages.length === 0) return;
  await prisma.userLanguage.createMany({
    data: languages.map((l) => ({ userId, code: l.code, label: l.label })),
  });
}

async function putDemoFile(
  storage: LocalPrivateStorageProvider,
  ownerId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<{ storageKey: string; sizeBytes: number }> {
  const put = await storage.put({
    buffer,
    mimeType,
    ownerId,
    keyPrefix: 'verification-demo',
  });
  return { storageKey: put.key, sizeBytes: put.sizeBytes };
}

async function upsertDocument(
  prisma: PrismaClient,
  storage: LocalPrivateStorageProvider,
  input: {
    userId: string;
    documentTypeId: string;
    verificationCaseId: string | null;
    status: 'PENDING' | 'APPROVED';
    mimeType: string;
    buffer: Buffer;
    originalFilename: string;
    identitySubType?: 'CIP' | 'PASSPORT' | null;
    capturedAt?: Date | null;
  },
) {
  const existing = await prisma.userDocument.findFirst({
    where: {
      userId: input.userId,
      documentTypeId: input.documentTypeId,
    },
    orderBy: { submittedAt: 'desc' },
  });

  const file = await putDemoFile(
    storage,
    input.userId,
    input.buffer,
    input.mimeType,
  );
  const reviewedAt =
    input.status === 'APPROVED' ? new Date() : null;

  if (existing) {
    // Remplace le fichier démo (nouvelle clé) ; ancien fichier non nettoyé volontairement (dev).
    return prisma.userDocument.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        storageKey: file.storageKey,
        mimeType: input.mimeType,
        sizeBytes: file.sizeBytes,
        originalFilename: input.originalFilename,
        identitySubType: input.identitySubType ?? null,
        capturedAt: input.capturedAt ?? null,
        verificationCaseId: input.verificationCaseId,
        reviewedAt,
        reasonCode: null,
        userMessage: null,
      },
    });
  }

  return prisma.userDocument.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      documentTypeId: input.documentTypeId,
      verificationCaseId: input.verificationCaseId,
      identitySubType: input.identitySubType ?? null,
      status: input.status,
      storageKey: file.storageKey,
      mimeType: input.mimeType,
      sizeBytes: file.sizeBytes,
      originalFilename: input.originalFilename,
      capturedAt: input.capturedAt ?? null,
      submittedAt: new Date(),
      reviewedAt,
    },
  });
}

async function upsertCase(
  prisma: PrismaClient,
  input: {
    userId: string;
    kind: 'IDENTITY' | 'JOBBER_PROFILE';
    status: 'PENDING' | 'APPROVED';
  },
) {
  const existing = await prisma.verificationCase.findFirst({
    where: { userId: input.userId, kind: input.kind },
    orderBy: { createdAt: 'desc' },
  });
  const now = new Date();
  if (existing) {
    return prisma.verificationCase.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        submittedAt: existing.submittedAt ?? now,
        reviewedAt: input.status === 'APPROVED' ? now : null,
        userMessage: null,
        reasonCode: null,
        internalNote:
          input.status === 'APPROVED'
            ? 'Dossier identité démo (APPROVED historique).'
            : 'Dossier de démonstration BO03 — à examiner.',
      },
    });
  }
  return prisma.verificationCase.create({
    data: {
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      status: input.status,
      submittedAt: now,
      reviewedAt: input.status === 'APPROVED' ? now : null,
      internalNote:
        input.status === 'APPROVED'
          ? 'Dossier identité démo (APPROVED historique).'
          : 'Dossier de démonstration BO03 — à examiner.',
    },
  });
}

export async function seedDemoVerifications(
  prisma: PrismaClient = new PrismaClient(),
): Promise<{ clientCaseId: string; jobberCaseId: string }> {
  const ctx = buildSafetyContextFromEnv();
  assertActionAllowed('seed-demo', ctx);

  const storage = new LocalPrivateStorageProvider(
    process.env.FILE_STORAGE_PATH || undefined,
  );

  const cip = await requireDocumentType(prisma, 'CIP');
  const passport = await requireDocumentType(prisma, 'PASSPORT');
  const residence = await requireDocumentType(prisma, 'RESIDENCE_CERTIFICATE');
  const selfie = await requireDocumentType(prisma, 'LIVE_SELFIE');
  const cv = await requireDocumentType(prisma, 'CV');
  const diploma = await requireDocumentType(prisma, 'DIPLOMA');

  // --- Client Aïcha ---
  const aicha = await upsertDemoUser(prisma, {
    email: DEMO_CLIENT_EMAIL,
    phone: '+22955501001',
    firstName: 'Aïcha',
    lastName: 'HOUNKPATIN',
    dateOfBirth: yearsAgo(28, 4, 12),
    city: 'Cotonou',
    addressLine: 'Adresse fictive démo — Quartier fictif, Cotonou (KingJOBS TEST)',
    identityVerificationStatus: 'PENDING',
  });
  await replaceLanguages(prisma, aicha.id, [
    { code: 'fr', label: 'Français' },
    { code: 'fon', label: 'Fon' },
  ]);
  await prisma.clientProfile.upsert({
    where: { userId: aicha.id },
    create: { id: randomUUID(), userId: aicha.id },
    update: {},
  });

  const aichaCase = await upsertCase(prisma, {
    userId: aicha.id,
    kind: 'IDENTITY',
    status: 'PENDING',
  });

  await upsertDocument(prisma, storage, {
    userId: aicha.id,
    documentTypeId: cip.id,
    verificationCaseId: aichaCase.id,
    status: 'APPROVED',
    mimeType: 'image/jpeg',
    buffer: demoJpegBuffer('demo-cip-aicha'),
    originalFilename: 'demo-cip-aicha.jpg',
    identitySubType: 'CIP',
  });
  await upsertDocument(prisma, storage, {
    userId: aicha.id,
    documentTypeId: residence.id,
    verificationCaseId: aichaCase.id,
    status: 'APPROVED',
    mimeType: 'application/pdf',
    buffer: demoPdfBuffer('demo-residence-aicha'),
    originalFilename: 'demo-residence-aicha.pdf',
  });
  await upsertDocument(prisma, storage, {
    userId: aicha.id,
    documentTypeId: selfie.id,
    verificationCaseId: aichaCase.id,
    status: 'PENDING',
    mimeType: 'image/jpeg',
    buffer: demoJpegBuffer('demo-selfie-aicha PLACEHOLDER'),
    originalFilename: 'demo-selfie-aicha.jpg',
    capturedAt: new Date(),
  });

  // --- Jobber Junior ---
  const junior = await upsertDemoUser(prisma, {
    email: DEMO_JOBBER_EMAIL,
    phone: '+22955501002',
    firstName: 'Junior',
    lastName: 'ADJOVI',
    dateOfBirth: yearsAgo(23, 6, 20),
    city: 'Abomey-Calavi',
    addressLine:
      'Adresse fictive démo — Zone universitaire fictive, Abomey-Calavi (KingJOBS TEST)',
    identityVerificationStatus: 'VERIFIED',
  });
  await replaceLanguages(prisma, junior.id, [
    { code: 'fr', label: 'Français' },
    { code: 'fon', label: 'Fon' },
    { code: 'en', label: 'Anglais' },
  ]);

  const identityCase = await upsertCase(prisma, {
    userId: junior.id,
    kind: 'IDENTITY',
    status: 'APPROVED',
  });
  await upsertDocument(prisma, storage, {
    userId: junior.id,
    documentTypeId: passport.id,
    verificationCaseId: identityCase.id,
    status: 'APPROVED',
    mimeType: 'image/jpeg',
    buffer: demoJpegBuffer('demo-passport-junior'),
    originalFilename: 'demo-passport-junior.jpg',
    identitySubType: 'PASSPORT',
  });
  await upsertDocument(prisma, storage, {
    userId: junior.id,
    documentTypeId: residence.id,
    verificationCaseId: identityCase.id,
    status: 'APPROVED',
    mimeType: 'application/pdf',
    buffer: demoPdfBuffer('demo-residence-junior'),
    originalFilename: 'demo-residence-junior.pdf',
  });
  await upsertDocument(prisma, storage, {
    userId: junior.id,
    documentTypeId: selfie.id,
    verificationCaseId: identityCase.id,
    status: 'APPROVED',
    mimeType: 'image/jpeg',
    buffer: demoJpegBuffer('demo-selfie-junior PLACEHOLDER'),
    originalFilename: 'demo-selfie-junior.jpg',
    capturedAt: new Date(Date.now() - 86_400_000),
  });

  const plumbing = await prisma.service.findUnique({
    where: { slug: 'plomberie' },
  });
  if (!plumbing) {
    throw new Error(
      'Service plomberie introuvable. Lancez npm run db:seed (catalogue) avant le seed démo.',
    );
  }

  const jobberProfile = await prisma.jobberProfile.upsert({
    where: { userId: junior.id },
    create: {
      id: randomUUID(),
      userId: junior.id,
      status: 'PENDING_VERIFICATION',
      headline: 'Plomberie et petits dépannages',
      bio: 'Je réalise des travaux de plomberie et de petits dépannages à domicile. Ponctuel et organisé, je suis disponible principalement à Cotonou et Abomey-Calavi.',
      yearsOfExperience: 1,
    },
    update: {
      status: 'PENDING_VERIFICATION',
      headline: 'Plomberie et petits dépannages',
      bio: 'Je réalise des travaux de plomberie et de petits dépannages à domicile. Ponctuel et organisé, je suis disponible principalement à Cotonou et Abomey-Calavi.',
      yearsOfExperience: 1,
    },
  });

  await prisma.jobberService.upsert({
    where: {
      jobberProfileId_serviceId: {
        jobberProfileId: jobberProfile.id,
        serviceId: plumbing.id,
      },
    },
    create: {
      id: randomUUID(),
      jobberProfileId: jobberProfile.id,
      serviceId: plumbing.id,
      status: 'PENDING_ELIGIBILITY',
      experienceDescription: 'Dépannages et installations sanitaires (démo).',
      yearsOfExperience: 1,
    },
    update: {
      status: 'PENDING_ELIGIBILITY',
      experienceDescription: 'Dépannages et installations sanitaires (démo).',
      yearsOfExperience: 1,
    },
  });

  const skills: Array<{ name: string; kind: 'QUALITY' | 'SKILL' }> = [
    { name: 'Ponctuel', kind: 'QUALITY' },
    { name: 'Organisé', kind: 'QUALITY' },
    { name: 'Plomberie', kind: 'SKILL' },
    { name: 'Petits dépannages', kind: 'SKILL' },
  ];
  for (const skill of skills) {
    const nameNormalized = skill.name.trim().toLowerCase();
    await prisma.jobberSkill.upsert({
      where: {
        jobberProfileId_nameNormalized_scopeKey: {
          jobberProfileId: jobberProfile.id,
          nameNormalized,
          scopeKey: 'profile',
        },
      },
      create: {
        id: randomUUID(),
        jobberProfileId: jobberProfile.id,
        kind: skill.kind,
        name: skill.name,
        nameNormalized,
        scopeKey: 'profile',
      },
      update: { kind: skill.kind, name: skill.name },
    });
  }

  await prisma.jobberEducation.deleteMany({
    where: { jobberProfileId: jobberProfile.id },
  });
  await prisma.jobberEducation.create({
    data: {
      id: randomUUID(),
      jobberProfileId: jobberProfile.id,
      title: 'Formation pratique en plomberie',
      institution: 'Centre de formation — Démonstration',
      field: 'Plomberie',
      startedOn: new Date('2023-01-01'),
      endedOn: new Date('2023-06-30'),
      description: 'Parcours fictif de démonstration KingJOBS.',
    },
  });

  await prisma.jobberExperience.deleteMany({
    where: { jobberProfileId: jobberProfile.id },
  });
  await prisma.jobberExperience.create({
    data: {
      id: randomUUID(),
      jobberProfileId: jobberProfile.id,
      title: 'Aide plombier',
      organization: 'Entreprise de démonstration',
      description: 'Assistance sur chantiers fictifs (installation et dépannage).',
      startedOn: new Date('2024-01-01'),
      endedOn: new Date('2024-12-31'),
      isCurrent: false,
    },
  });

  const jobberCase = await upsertCase(prisma, {
    userId: junior.id,
    kind: 'JOBBER_PROFILE',
    status: 'PENDING',
  });

  // Documents pro facultatifs (sauf si un ServiceRequirement réel existe — non inventé ici).
  await upsertDocument(prisma, storage, {
    userId: junior.id,
    documentTypeId: cv.id,
    verificationCaseId: jobberCase.id,
    status: 'PENDING',
    mimeType: 'application/pdf',
    buffer: demoPdfBuffer('demo-cv-junior'),
    originalFilename: 'demo-cv-junior.pdf',
  });
  await upsertDocument(prisma, storage, {
    userId: junior.id,
    documentTypeId: diploma.id,
    verificationCaseId: jobberCase.id,
    status: 'PENDING',
    mimeType: 'application/pdf',
    buffer: demoPdfBuffer('demo-diplome-junior'),
    originalFilename: 'demo-diplome-junior.pdf',
  });

  // Si Plomberie a déjà un DOCUMENT requirement obligatoire dans le catalogue : document APPROVED.
  const mandatoryReqs = await prisma.serviceRequirement.findMany({
    where: {
      serviceId: plumbing.id,
      type: 'DOCUMENT',
      isRequired: true,
      isActive: true,
      documentTypeId: { not: null },
    },
  });
  for (const req of mandatoryReqs) {
    if (!req.documentTypeId) continue;
    await upsertDocument(prisma, storage, {
      userId: junior.id,
      documentTypeId: req.documentTypeId,
      verificationCaseId: jobberCase.id,
      status: 'APPROVED',
      mimeType: 'application/pdf',
      buffer: demoPdfBuffer(`demo-req-${req.code}`),
      originalFilename: `demo-requirement-${req.code}.pdf`,
    });
  }

  // Fingerprint stable pour logs (pas de PII réelle).
  const fingerprint = createHash('sha256')
    .update(`${DEMO_CLIENT_EMAIL}|${DEMO_JOBBER_EMAIL}`)
    .digest('hex')
    .slice(0, 12);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        fingerprint,
        client: {
          email: DEMO_CLIENT_EMAIL,
          caseId: aichaCase.id,
          kind: 'IDENTITY',
          status: 'PENDING',
        },
        jobber: {
          email: DEMO_JOBBER_EMAIL,
          caseId: jobberCase.id,
          kind: 'JOBBER_PROFILE',
          status: 'PENDING',
          service: plumbing.slug,
        },
      },
      null,
      2,
    ),
  );

  return { clientCaseId: aichaCase.id, jobberCaseId: jobberCase.id };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await seedDemoVerifications(prisma);
  } catch (error) {
    if (error instanceof DbSafetyError) {
      // eslint-disable-next-line no-console
      console.error(`DB SAFETY: ${error.message}`);
      process.exit(1);
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
