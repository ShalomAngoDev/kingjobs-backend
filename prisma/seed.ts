import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  CATALOG_CATEGORY_SEEDS,
  CATALOG_SERVICE_SEEDS,
  DOCUMENT_TYPE_SEEDS,
} from '../src/common/constants/catalog-seed-data';
import { CATALOG_COUNTS } from '../src/common/constants/catalog-limits';

const prisma = new PrismaClient();

/**
 * Seed idempotent du catalogue KingJOBS (données de RÉFÉRENCE uniquement).
 * Ne crée PAS d'utilisateurs / missions / fixtures démo.
 * Préférer : npm run db:seed (passe par le guard DATABASE_ENV).
 */
export async function seedCatalog(client: PrismaClient = prisma) {
  if (CATALOG_CATEGORY_SEEDS.length !== CATALOG_COUNTS.CATEGORIES) {
    throw new Error(
      `Seed catégories: attendu ${CATALOG_COUNTS.CATEGORIES}, reçu ${CATALOG_CATEGORY_SEEDS.length}`,
    );
  }
  if (CATALOG_SERVICE_SEEDS.length !== CATALOG_COUNTS.SERVICES) {
    throw new Error(
      `Seed services: attendu ${CATALOG_COUNTS.SERVICES}, reçu ${CATALOG_SERVICE_SEEDS.length}`,
    );
  }

  for (const doc of DOCUMENT_TYPE_SEEDS) {
    await client.documentType.upsert({
      where: { code: doc.code },
      create: {
        id: randomUUID(),
        code: doc.code,
        name: doc.name,
        description: doc.description,
        isActive: true,
      },
      update: {
        name: doc.name,
        description: doc.description,
        isActive: true,
      },
    });
  }

  const categoryIds = new Map<string, string>();

  for (const category of CATALOG_CATEGORY_SEEDS) {
    const row = await client.serviceCategory.upsert({
      where: { slug: category.slug },
      create: {
        id: randomUUID(),
        slug: category.slug,
        name: category.name,
        description: category.description,
        displayOrder: category.displayOrder,
        isActive: true,
      },
      update: {
        name: category.name,
        description: category.description,
        displayOrder: category.displayOrder,
        isActive: true,
      },
    });
    categoryIds.set(category.slug, row.id);
  }

  for (const service of CATALOG_SERVICE_SEEDS) {
    const categoryId = categoryIds.get(service.categorySlug);
    if (!categoryId) {
      throw new Error(`Catégorie introuvable pour ${service.slug}`);
    }

    await client.service.upsert({
      where: { slug: service.slug },
      create: {
        id: randomUUID(),
        categoryId,
        slug: service.slug,
        name: service.name,
        shortDescription: service.shortDescription,
        displayOrder: service.displayOrder,
        minimumAge: service.minimumAge,
        isActive: true,
      },
      update: {
        categoryId,
        name: service.name,
        shortDescription: service.shortDescription,
        displayOrder: service.displayOrder,
        minimumAge: service.minimumAge,
        isActive: true,
      },
    });
  }

  const officialCategorySlugs = CATALOG_CATEGORY_SEEDS.map((c) => c.slug);
  const officialServiceSlugs = CATALOG_SERVICE_SEEDS.map((s) => s.slug);

  await client.serviceCategory.updateMany({
    where: { slug: { notIn: officialCategorySlugs } },
    data: { isActive: false },
  });

  await client.service.updateMany({
    where: { slug: { notIn: officialServiceSlugs } },
    data: { isActive: false },
  });

  const [categories, services] = await Promise.all([
    client.serviceCategory.count(),
    client.service.count(),
  ]);

  return { categories, services };
}

async function main() {
  const result = await seedCatalog();
  // eslint-disable-next-line no-console
  console.log(
    `Catalogue seed OK — catégories=${result.categories}, services=${result.services}`,
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
