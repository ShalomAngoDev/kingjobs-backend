/**
 * Seed démo BO04 — missions en file de revue (development uniquement).
 * Commande : DATABASE_ENV=development npx ts-node --transpile-only prisma/seed-demo-missions.ts
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
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
import { LocalPrivateStorageProvider } from '../src/infrastructure/storage/local-private-storage.provider';
import { DEMO_CLIENT_EMAIL } from './seed-demo-verifications';

const prisma = new PrismaClient();
const storage = new LocalPrivateStorageProvider(
  process.env.FILE_STORAGE_PATH || undefined,
);

const DEMO_PHOTOS_DIR = join(__dirname, 'fixtures', 'demo-mission-photos');
const DEMO_MISSION_PHOTO_FILES = [
  'fuite-evier.jpg',
  'sous-evier.jpg',
  'cuisine.jpg',
] as const;

const AICHAT_PLOMBERIE_DESCRIPTION = `Bonjour,

Je cherche un plombier pour réparer une fuite sous mon évier de cuisine à Fidjrossè (Cotonou).

Le problème a commencé hier soir : de l’eau s’accumule dans le placard sous l’évier dès qu’on ouvre le robinet. J’ai mis une bassine pour limiter les dégâts, mais ça continue de goutter. Le joint du siphon me semble abîmé, et il y a aussi un peu d’humidité sur le tuyau d’arrivée d’eau froide.

Merci de venir avec vos outils (clés, joints, colliers, éventuellement un siphon de rechange). L’accès se fait par la rue principale, maison en face de la pharmacie. Je serai sur place pour ouvrir.

Photos jointes : vue de la cuisine, gros plan sous l’évier, et détail de la fuite.`;

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
    throw new Error('Services plomberie / nettoyage-evenementiel requis (catalogue).');
  }

  const now = new Date();
  const refSeq = async () => {
    const rows = await prisma.$queryRaw<
      Array<{ nextval: bigint | number | string }>
    >`SELECT nextval('mission_reference_seq')::bigint AS nextval`;
    return Number(rows[0]?.nextval ?? 1);
  };

  async function createReviewMission(input: {
    referenceSuffix: number;
    service: typeof plomberie;
    title: string;
    description: string;
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
    const seq = await refSeq();
    const reference = `KJ-${now.getUTCFullYear()}-${String(seq).padStart(6, '0')}`;
    const id = randomUUID();
    const startDate = new Date(
      Date.UTC(
        input.scheduledStartAt.getUTCFullYear(),
        input.scheduledStartAt.getUTCMonth(),
        input.scheduledStartAt.getUTCDate(),
      ),
    );

    await prisma.mission.create({
      data: {
        id,
        reference,
        clientUserId: client.id,
        serviceId: input.service.id,
        title: input.title,
        description: input.description,
        city: input.city,
        district: input.district,
        locationNotes: 'Maison en face de la pharmacie (démo).',
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
        status: MissionStatus.PENDING_REVIEW,
        paymentConfirmedAt: now,
        submittedForReviewAt: now,
        serviceNameSnapshot: input.service.name,
        serviceSlugSnapshot: input.service.slug,
        categoryNameSnapshot: input.service.category.name,
        categorySlugSnapshot: input.service.category.slug,
        statusHistory: {
          create: [
            {
              fromStatus: null,
              toStatus: MissionStatus.DRAFT,
              actorUserId: client.id,
              reason: 'Seed démo BO04.1',
            },
            {
              fromStatus: MissionStatus.DRAFT,
              toStatus: MissionStatus.PAYMENT_REQUIRED,
              actorUserId: client.id,
            },
            {
              fromStatus: MissionStatus.PAYMENT_REQUIRED,
              toStatus: MissionStatus.PENDING_REVIEW,
              reason: 'Paiement publication confirmé (dev)',
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
    return { id, reference };
  }

  async function attachDemoPhotos(missionId: string, uploadedByUserId: string) {
    await prisma.missionMedia.deleteMany({ where: { missionId } });
    for (let i = 0; i < DEMO_MISSION_PHOTO_FILES.length; i += 1) {
      const filename = DEMO_MISSION_PHOTO_FILES[i];
      const buffer = await readFile(join(DEMO_PHOTOS_DIR, filename));
      const put = await storage.put({
        buffer,
        mimeType: 'image/jpeg',
        ownerId: uploadedByUserId,
        keyPrefix: 'mission-demo',
      });
      await prisma.missionMedia.create({
        data: {
          id: randomUUID(),
          missionId,
          mediaType: MissionMediaType.IMAGE,
          mimeType: 'image/jpeg',
          sizeBytes: put.sizeBytes,
          storageKey: put.key,
          uploadedByUserId,
          sortOrder: i,
        },
      });
    }
  }

  const missionA = await createReviewMission({
    referenceSuffix: 142,
    service: plomberie,
    title: 'Je recherche un plombier pour réparer une fuite',
    description: AICHAT_PLOMBERIE_DESCRIPTION,
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
  await attachDemoPhotos(missionA.id, client.id);

  const missionB = await createReviewMission({
    referenceSuffix: 143,
    service: nettoyage,
    title: 'Nettoyage après événement',
    description:
      'Besoin de 10 personnes pour remettre en état une salle après événement.',
    city: 'Cotonou',
    district: 'Cadjehoun',
    workersNeeded: 10,
    pricingType: MissionPricingType.HOURLY,
    rateScope: MissionRateScope.TOTAL,
    rateAmount: 20_000,
    estimatedTotalAmount: 80_000,
    durationKnown: true,
    estimatedDurationMinutes: 240,
    scheduledStartAt: new Date('2026-10-12T08:00:00.000Z'),
  });

  console.log(
    JSON.stringify(
      { ok: true, missionA, missionB, clientEmail: DEMO_CLIENT_EMAIL },
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
