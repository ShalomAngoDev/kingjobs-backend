/**
 * Seed démo BO05 - candidatures + affectations multi-Jobber (development uniquement).
 * Idempotent. Emails @kingjobs.test uniquement.
 *
 * Prérequis : catalogue (db:seed) + client démo (db:seed:demo:verifications).
 * Commande : npm run db:seed:demo:applications
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MissionApplicationStatus,
  MissionAssignmentStatus,
  MissionMediaType,
  MissionPricingType,
  MissionRateScope,
  MissionSchedulingType,
  MissionStatus,
  PrismaClient,
} from '@prisma/client';
import {
  assertActionAllowed,
  buildSafetyContextFromEnv,
  DbSafetyError,
} from '../src/common/db/db-safety';
import { hashPassword } from '../src/common/utils/password';
import { normalizeEmail } from '../src/common/utils/email-normalize';
import { LocalPrivateStorageProvider } from '../src/infrastructure/storage/local-private-storage.provider';
import { KINGJOBS_COMMISSION_BPS } from '../src/modules/missions/mission-pricing';
import { DEMO_CLIENT_EMAIL } from './seed-demo-verifications';

const prisma = new PrismaClient();
const storage = new LocalPrivateStorageProvider(
  process.env.FILE_STORAGE_PATH || undefined,
);

const DEMO_PASSWORD = 'Demo!KingJobs-NotReal';
const DEMO_MARKER = '[DEMO BO05]';
const DEMO_PHOTOS_DIR = join(__dirname, 'fixtures', 'demo-mission-photos');

const AICHAT_PLOMBERIE_DESCRIPTION = `${DEMO_MARKER}

Bonjour,

Je cherche un plombier pour réparer une fuite sous mon évier de cuisine à Fidjrossè (Cotonou).

Le problème a commencé hier soir : de l’eau s’accumule dans le placard sous l’évier dès qu’on ouvre le robinet. J’ai mis une bassine pour limiter les dégâts, mais ça continue de goutter. Le joint du siphon me semble abîmé, et il y a aussi un peu d’humidité sur le tuyau d’arrivée d’eau froide.

Merci de venir avec vos outils (clés, joints, colliers, éventuellement un siphon de rechange). L’accès se fait par la rue principale, maison en face de la pharmacie. Je serai sur place pour ouvrir.

Photos jointes : vue de la cuisine, gros plan sous l’évier, et détail de la fuite.`.trim();

const DEMO_MISSION_PHOTO_FILES = [
  'fuite-evier.jpg',
  'sous-evier.jpg',
  'cuisine.jpg',
] as const;

const DEMO_JOBBER_SPECS: Array<{
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  services: Array<'plomberie' | 'nettoyage'>;
}> = [
  {
    email: 'jobber.demo.01@kingjobs.test',
    firstName: 'Koffi',
    lastName: 'DEMO',
    phone: '+22955502001',
    services: ['plomberie', 'nettoyage'],
  },
  {
    email: 'jobber.demo.02@kingjobs.test',
    firstName: 'Amina',
    lastName: 'DEMO',
    phone: '+22955502002',
    services: ['plomberie', 'nettoyage'],
  },
  {
    email: 'jobber.demo.03@kingjobs.test',
    firstName: 'Serge',
    lastName: 'DEMO',
    phone: '+22955502003',
    services: ['plomberie', 'nettoyage'],
  },
  {
    email: 'jobber.demo.04@kingjobs.test',
    firstName: 'Fatou',
    lastName: 'DEMO',
    phone: '+22955502004',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.05@kingjobs.test',
    firstName: 'Yao',
    lastName: 'DEMO',
    phone: '+22955502005',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.06@kingjobs.test',
    firstName: 'Binta',
    lastName: 'DEMO',
    phone: '+22955502006',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.07@kingjobs.test',
    firstName: 'Idriss',
    lastName: 'DEMO',
    phone: '+22955502007',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.08@kingjobs.test',
    firstName: 'Nadia',
    lastName: 'DEMO',
    phone: '+22955502008',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.09@kingjobs.test',
    firstName: 'Mamadou',
    lastName: 'DEMO',
    phone: '+22955502009',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.10@kingjobs.test',
    firstName: 'Chantal',
    lastName: 'DEMO',
    phone: '+22955502010',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.11@kingjobs.test',
    firstName: 'Omar',
    lastName: 'DEMO',
    phone: '+22955502011',
    services: ['nettoyage'],
  },
  {
    email: 'jobber.demo.12@kingjobs.test',
    firstName: 'Léa',
    lastName: 'DEMO',
    phone: '+22955502012',
    services: ['nettoyage'],
  },
];

function yearsAgo(years: number, month = 5, day = 10): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() - years, month - 1, day));
}

async function upsertDemoJobber(
  input: (typeof DEMO_JOBBER_SPECS)[number],
  serviceIds: { plomberie: string; nettoyage: string },
  passwordHash: string,
) {
  const emailNormalized = normalizeEmail(input.email);
  const existing = await prisma.user.findUnique({ where: { emailNormalized } });
  const userData = {
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    emailNormalized,
    phone: input.phone,
    passwordHash,
    dateOfBirth: yearsAgo(24),
    status: 'ACTIVE' as const,
    role: 'USER' as const,
    legalGuardianStatus: 'NOT_REQUIRED' as const,
    identityVerificationStatus: 'VERIFIED' as const,
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
    countryCode: 'BJ',
    city: 'Cotonou',
    addressLine: `Adresse fictive démo ${input.firstName} (KingJOBS TEST)`,
    administrativeArea: 'Littoral (démo)',
  };

  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data: userData })
    : await prisma.user.create({ data: { id: randomUUID(), ...userData } });

  const profile = await prisma.jobberProfile.upsert({
    where: { userId: user.id },
    create: {
      id: randomUUID(),
      userId: user.id,
      status: 'ACTIVE',
      headline: `Jobber démo ${input.firstName}`,
      bio: `${DEMO_MARKER} Profil Jobber éligible pour tests BO05.`,
      yearsOfExperience: 2,
    },
    update: {
      status: 'ACTIVE',
      headline: `Jobber démo ${input.firstName}`,
      bio: `${DEMO_MARKER} Profil Jobber éligible pour tests BO05.`,
      yearsOfExperience: 2,
    },
  });

  for (const key of input.services) {
    const serviceId = serviceIds[key];
    await prisma.jobberService.upsert({
      where: {
        jobberProfileId_serviceId: {
          jobberProfileId: profile.id,
          serviceId,
        },
      },
      create: {
        id: randomUUID(),
        jobberProfileId: profile.id,
        serviceId,
        status: 'ELIGIBLE',
        experienceDescription: `${DEMO_MARKER} Service éligible.`,
        yearsOfExperience: 2,
      },
      update: {
        status: 'ELIGIBLE',
        experienceDescription: `${DEMO_MARKER} Service éligible.`,
        yearsOfExperience: 2,
      },
    });
  }

  return user;
}

async function nextReference(): Promise<string> {
  const rows = await prisma.$queryRaw<
    Array<{ nextval: bigint | number | string }>
  >`SELECT nextval('mission_reference_seq')::bigint AS nextval`;
  const seq = Number(rows[0]?.nextval ?? 1);
  return `KJ-${new Date().getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
}

async function upsertPublishedDemoMission(input: {
  title: string;
  description: string;
  clientUserId: string;
  service: {
    id: string;
    name: string;
    slug: string;
    category: { name: string; slug: string };
  };
  city: string;
  district: string;
  workersNeeded: number;
  pricingType: MissionPricingType;
  rateScope: MissionRateScope;
  rateAmount: number;
  estimatedTotalAmount: number;
  durationKnown: boolean;
  estimatedDurationMinutes?: number | null;
  scheduledStartAt: Date;
}) {
  const existing = await prisma.mission.findFirst({
    where: {
      title: input.title,
      clientUserId: input.clientUserId,
      description: { contains: DEMO_MARKER },
    },
  });

  const now = new Date();
  const startDate = new Date(
    Date.UTC(
      input.scheduledStartAt.getUTCFullYear(),
      input.scheduledStartAt.getUTCMonth(),
      input.scheduledStartAt.getUTCDate(),
    ),
  );

  const common = {
    serviceId: input.service.id,
    title: input.title,
    description: input.description,
    city: input.city,
    district: input.district,
    locationNotes: `${DEMO_MARKER} Indications fictives.`,
    latitude: 6.3654,
    longitude: 2.4183,
    schedulingType: MissionSchedulingType.ONCE,
    scheduleStartDate: startDate,
    scheduleEndDate: startDate,
    durationKnown: input.durationKnown,
    estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
    scheduledStartAt: input.scheduledStartAt,
    workersNeeded: input.workersNeeded,
    pricingType: input.pricingType,
    rateScope: input.rateScope,
    rateAmount: input.rateAmount,
    clientPriceAmount: input.estimatedTotalAmount,
    estimatedAmount: input.estimatedTotalAmount,
    status: MissionStatus.PUBLISHED,
    paymentConfirmedAt: now,
    submittedForReviewAt: now,
    publishedAt: now,
    serviceNameSnapshot: input.service.name,
    serviceSlugSnapshot: input.service.slug,
    categoryNameSnapshot: input.service.category.name,
    categorySlugSnapshot: input.service.category.slug,
    selectedJobberUserId: null as string | null,
    assignedAt: null as Date | null,
    confirmedAt: null as Date | null,
  };

  if (existing) {
    // Remplace candidatures / affectations pour rester idempotent.
    await prisma.missionAssignment.deleteMany({ where: { missionId: existing.id } });
    await prisma.missionApplication.deleteMany({ where: { missionId: existing.id } });
    await prisma.missionOccurrence.deleteMany({ where: { missionId: existing.id } });
    await prisma.missionStatusHistory.deleteMany({ where: { missionId: existing.id } });

    const mission = await prisma.mission.update({
      where: { id: existing.id },
      data: {
        ...common,
        statusHistory: {
          create: [
            {
              fromStatus: null,
              toStatus: MissionStatus.DRAFT,
              actorUserId: input.clientUserId,
              reason: 'Seed démo BO05 (rejeu)',
            },
            {
              fromStatus: MissionStatus.DRAFT,
              toStatus: MissionStatus.PAYMENT_REQUIRED,
              actorUserId: input.clientUserId,
            },
            {
              fromStatus: MissionStatus.PAYMENT_REQUIRED,
              toStatus: MissionStatus.PENDING_REVIEW,
              reason: 'Paiement publication confirmé (dev)',
            },
            {
              fromStatus: MissionStatus.PENDING_REVIEW,
              toStatus: MissionStatus.PUBLISHED,
              reason: 'Approuvée (seed démo BO05)',
            },
          ],
        },
        occurrences: {
          create: {
            occurrenceDate: startDate,
            plannedStartAt: input.scheduledStartAt,
            estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
            sortOrder: 0,
          },
        },
      },
    });
    return mission;
  }

  const reference = await nextReference();
  return prisma.mission.create({
    data: {
      id: randomUUID(),
      reference,
      clientUserId: input.clientUserId,
      ...common,
      statusHistory: {
        create: [
          {
            fromStatus: null,
            toStatus: MissionStatus.DRAFT,
            actorUserId: input.clientUserId,
            reason: 'Seed démo BO05',
          },
          {
            fromStatus: MissionStatus.DRAFT,
            toStatus: MissionStatus.PAYMENT_REQUIRED,
            actorUserId: input.clientUserId,
          },
          {
            fromStatus: MissionStatus.PAYMENT_REQUIRED,
            toStatus: MissionStatus.PENDING_REVIEW,
            reason: 'Paiement publication confirmé (dev)',
          },
          {
            fromStatus: MissionStatus.PENDING_REVIEW,
            toStatus: MissionStatus.PUBLISHED,
            reason: 'Approuvée (seed démo BO05)',
          },
        ],
      },
      occurrences: {
        create: {
          occurrenceDate: startDate,
          plannedStartAt: input.scheduledStartAt,
          estimatedDurationMinutes: input.estimatedDurationMinutes ?? null,
          sortOrder: 0,
        },
      },
    },
  });
}

async function createApplicationWithOptionalAssignment(input: {
  missionId: string;
  jobberUserId: string;
  clientUserId: string;
  status: MissionApplicationStatus;
  workerGrossAmount: number;
  selectedAt?: Date | null;
}) {
  const now = new Date();
  const selectedAt =
    input.status === MissionApplicationStatus.SELECTED
      ? (input.selectedAt ?? now)
      : null;

  const application = await prisma.missionApplication.create({
    data: {
      id: randomUUID(),
      missionId: input.missionId,
      jobberUserId: input.jobberUserId,
      status: input.status,
      message: `${DEMO_MARKER} Candidature démo.`,
      appliedAt: now,
      selectedAt,
    },
  });

  if (input.status !== MissionApplicationStatus.SELECTED || !selectedAt) {
    return application;
  }

  await prisma.missionAssignment.create({
    data: {
      id: randomUUID(),
      missionId: input.missionId,
      jobberUserId: input.jobberUserId,
      applicationId: application.id,
      status: MissionAssignmentStatus.ACTIVE,
      selectedAt,
      selectedByUserId: input.clientUserId,
      workerGrossAmount: input.workerGrossAmount,
      commissionRateBps: KINGJOBS_COMMISSION_BPS,
      currency: 'XOF',
    },
  });

  return application;
}

async function replaceMissionPhotos(input: {
  missionId: string;
  uploadedByUserId: string;
  filenames: readonly string[];
}) {
  await prisma.missionMedia.deleteMany({ where: { missionId: input.missionId } });

  for (let i = 0; i < input.filenames.length; i += 1) {
    const filename = input.filenames[i];
    const buffer = await readFile(join(DEMO_PHOTOS_DIR, filename));
    const put = await storage.put({
      buffer,
      mimeType: 'image/jpeg',
      ownerId: input.uploadedByUserId,
      keyPrefix: 'mission-demo',
    });
    await prisma.missionMedia.create({
      data: {
        id: randomUUID(),
        missionId: input.missionId,
        mediaType: MissionMediaType.IMAGE,
        mimeType: 'image/jpeg',
        sizeBytes: put.sizeBytes,
        storageKey: put.key,
        uploadedByUserId: input.uploadedByUserId,
        sortOrder: i,
      },
    });
  }
}

async function main() {
  const ctx = buildSafetyContextFromEnv();
  assertActionAllowed('seed-demo', ctx);

  const client = await prisma.user.findFirst({
    where: { emailNormalized: DEMO_CLIENT_EMAIL.toLowerCase() },
  });
  if (!client) {
    throw new Error(
      `Client démo introuvable (${DEMO_CLIENT_EMAIL}). Lancez db:seed:demo:verifications.`,
    );
  }

  const plomberie = await prisma.service.findFirst({
    where: { slug: 'plomberie', isActive: true },
    include: { category: true },
  });
  const nettoyage = await prisma.service.findFirst({
    where: { slug: 'nettoyage-evenementiel', isActive: true },
    include: { category: true },
  });
  if (!plomberie || !nettoyage) {
    throw new Error(
      'Services plomberie / nettoyage-evenementiel requis (catalogue).',
    );
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const jobbers = [];
  for (const spec of DEMO_JOBBER_SPECS) {
    jobbers.push(
      await upsertDemoJobber(
        spec,
        { plomberie: plomberie.id, nettoyage: nettoyage.id },
        passwordHash,
      ),
    );
  }

  const missionPlomberie = await upsertPublishedDemoMission({
    title: `${DEMO_MARKER} Plomberie fuite (1 place)`,
    description: AICHAT_PLOMBERIE_DESCRIPTION,
    clientUserId: client.id,
    service: plomberie,
    city: 'Cotonou',
    district: 'Fidjrossè',
    workersNeeded: 1,
    pricingType: MissionPricingType.FIXED,
    rateScope: MissionRateScope.PER_JOBBER,
    rateAmount: 10_000,
    estimatedTotalAmount: 10_000,
    durationKnown: false,
    scheduledStartAt: new Date('2026-10-05T14:00:00.000Z'),
  });
  await replaceMissionPhotos({
    missionId: missionPlomberie.id,
    uploadedByUserId: client.id,
    filenames: DEMO_MISSION_PHOTO_FILES,
  });

  // La mission marketplace Jobber (ouverte, sans Jobber sélectionné) est souvent
  // une autre fiche Aïcha (ex. seed revue puis publiée). On l'enrichit aussi.
  const marketplacePlomberie = await prisma.mission.findFirst({
    where: {
      clientUserId: client.id,
      serviceId: plomberie.id,
      city: 'Cotonou',
      district: 'Fidjrossè',
      status: MissionStatus.PUBLISHED,
      selectedJobberUserId: null,
      NOT: { id: missionPlomberie.id },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (marketplacePlomberie) {
    await prisma.mission.update({
      where: { id: marketplacePlomberie.id },
      data: {
        description: AICHAT_PLOMBERIE_DESCRIPTION.replace(DEMO_MARKER, '').trim(),
        scheduledStartAt: new Date('2026-10-05T14:00:00.000Z'),
        rateAmount: 10_000,
        clientPriceAmount: 10_000,
        estimatedAmount: 10_000,
      },
    });
    await replaceMissionPhotos({
      missionId: marketplacePlomberie.id,
      uploadedByUserId: client.id,
      filenames: DEMO_MISSION_PHOTO_FILES,
    });
  }

  const plomberieJobbers = jobbers.slice(0, 3);
  await createApplicationWithOptionalAssignment({
    missionId: missionPlomberie.id,
    jobberUserId: plomberieJobbers[0].id,
    clientUserId: client.id,
    status: MissionApplicationStatus.SELECTED,
    workerGrossAmount: 10_000,
  });
  await createApplicationWithOptionalAssignment({
    missionId: missionPlomberie.id,
    jobberUserId: plomberieJobbers[1].id,
    clientUserId: client.id,
    status: MissionApplicationStatus.PENDING,
    workerGrossAmount: 10_000,
  });
  await createApplicationWithOptionalAssignment({
    missionId: missionPlomberie.id,
    jobberUserId: plomberieJobbers[2].id,
    clientUserId: client.id,
    status: MissionApplicationStatus.PENDING,
    workerGrossAmount: 10_000,
  });
  await prisma.mission.update({
    where: { id: missionPlomberie.id },
    data: {
      selectedJobberUserId: plomberieJobbers[0].id,
      assignedAt: new Date(),
    },
  });

  const missionNettoyage = await upsertPublishedDemoMission({
    title: `${DEMO_MARKER} Nettoyage événement (10 places)`,
    description: `${DEMO_MARKER} Mission démo nettoyage, 10 personnes recherchées. ~12 candidatures, 6 sélectionnées.`,
    clientUserId: client.id,
    service: nettoyage,
    city: 'Cotonou',
    district: 'Cadjehoun',
    workersNeeded: 10,
    pricingType: MissionPricingType.HOURLY,
    rateScope: MissionRateScope.TOTAL,
    rateAmount: 20_000,
    estimatedTotalAmount: 80_000,
    durationKnown: true,
    estimatedDurationMinutes: 240,
    scheduledStartAt: new Date('2026-10-25T08:00:00.000Z'),
  });

  const grossPerJobber = 8_000;
  for (let i = 0; i < 12; i += 1) {
    const jobber = jobbers[i];
    await createApplicationWithOptionalAssignment({
      missionId: missionNettoyage.id,
      jobberUserId: jobber.id,
      clientUserId: client.id,
      status:
        i < 6
          ? MissionApplicationStatus.SELECTED
          : MissionApplicationStatus.PENDING,
      workerGrossAmount: grossPerJobber,
      selectedAt: i < 6 ? new Date(Date.now() - (6 - i) * 60_000) : null,
    });
  }
  await prisma.mission.update({
    where: { id: missionNettoyage.id },
    data: {
      selectedJobberUserId: jobbers[0].id,
      assignedAt: new Date(),
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        marker: DEMO_MARKER,
        clientEmail: DEMO_CLIENT_EMAIL,
        jobbers: DEMO_JOBBER_SPECS.map((j) => j.email),
        missionPlomberie: {
          id: missionPlomberie.id,
          reference: missionPlomberie.reference,
          workersNeeded: 1,
          applications: 3,
          selected: 1,
          photos: DEMO_MISSION_PHOTO_FILES.length,
        },
        missionNettoyage: {
          id: missionNettoyage.id,
          reference: missionNettoyage.reference,
          workersNeeded: 10,
          applications: 12,
          selected: 6,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    if (error instanceof DbSafetyError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
