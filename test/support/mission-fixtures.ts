import { randomUUID } from 'node:crypto';
import type { InMemoryPrisma } from './in-memory-prisma';

export const ADULT_DOB = new Date('1995-05-10T00:00:00.000Z');

export type World = {
  client: Record<string, any>;
  jobber: Record<string, any>;
  jobber2: Record<string, any>;
  category: Record<string, any>;
  service: Record<string, any>;
};

export async function createUser(
  db: InMemoryPrisma,
  overrides: Record<string, any> = {},
) {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      firstName: 'Prénom',
      lastName: 'Nom',
      email: `${id}@example.test`,
      phone: `+229${Math.floor(Math.random() * 1e8)}`,
      passwordHash: 'hash-secret',
      dateOfBirth: ADULT_DOB,
      status: 'ACTIVE',
      role: 'USER',
      legalGuardianStatus: 'NOT_REQUIRED',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      ...overrides,
    },
  });
}

export async function createJobber(
  db: InMemoryPrisma,
  serviceId: string,
  overrides: Record<string, any> = {},
) {
  const user = await createUser(db, overrides);
  const profile = await db.jobberProfile.create({
    data: {
      userId: user.id,
      status: 'ACTIVE',
      headline: 'Pro du ménage',
      bio: 'Dix ans d’expérience',
    },
  });
  await db.jobberService.create({
    data: {
      jobberProfileId: profile.id,
      serviceId,
      status: 'ELIGIBLE',
    },
  });
  return user;
}

/** Monde minimal : 1 client, 2 jobbers éligibles, 1 catégorie, 1 service actif (16 ans). */
export async function seedWorld(db: InMemoryPrisma): Promise<World> {
  const category = await db.serviceCategory.create({
    data: {
      name: 'Maison & Entretien',
      slug: 'maison-entretien',
      isActive: true,
    },
  });
  const service = await db.service.create({
    data: {
      categoryId: category.id,
      name: 'Ménage',
      slug: 'menage',
      isActive: true,
      minimumAge: 16,
    },
  });
  const client = await createUser(db, {
    firstName: 'Cora',
    lastName: 'Client',
  });
  const jobber = await createJobber(db, service.id, {
    firstName: 'Jules',
    lastName: 'Jobber',
  });
  const jobber2 = await createJobber(db, service.id, {
    firstName: 'Julie',
    lastName: 'Deux',
  });
  return { client, jobber, jobber2, category, service };
}

let referenceCounter = 0;

/** Insère directement une mission dans un statut donné (hors machine à états). */
export async function insertMission(
  db: InMemoryPrisma,
  world: World,
  overrides: Record<string, any> = {},
) {
  referenceCounter += 1;
  return db.mission.create({
    data: {
      reference: `KJ-2026-${String(referenceCounter).padStart(6, '0')}`,
      clientUserId: world.client.id,
      serviceId: world.service.id,
      title: 'Ménage appartement',
      description: 'Nettoyage complet de mon appartement de 3 pièces.',
      city: 'Cotonou',
      district: 'Fidjrossè',
      addressLine: '12 rue des Cocotiers',
      latitude: 6.3654,
      longitude: 2.4183,
      clientPriceAmount: 15000,
      serviceNameSnapshot: world.service.name,
      serviceSlugSnapshot: world.service.slug,
      categoryNameSnapshot: world.category.name,
      categorySlugSnapshot: world.category.slug,
      ...overrides,
    },
  });
}

export async function insertApplication(
  db: InMemoryPrisma,
  missionId: string,
  jobberUserId: string,
  overrides: Record<string, any> = {},
) {
  return db.missionApplication.create({
    data: { missionId, jobberUserId, message: 'Disponible !', ...overrides },
  });
}
