import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CATALOG_COUNTS } from '../../common/constants/catalog-limits';
import {
  CATALOG_CATEGORY_SEEDS,
  CATALOG_SERVICE_SEEDS,
} from '../../common/constants/catalog-seed-data';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const prisma = {
    serviceCategory: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    service: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    serviceRequirement: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    documentType: { findUnique: jest.fn() },
  };
  const service = new CatalogService(prisma as unknown as PrismaService);

  const now = new Date('2026-10-01T00:00:00.000Z');
  const category = {
    id: 'c1',
    name: 'Maison',
    slug: 'maison',
    description: null,
    displayOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('seed data', () => {
    it('has the official category count', () => {
      expect(CATALOG_CATEGORY_SEEDS).toHaveLength(CATALOG_COUNTS.CATEGORIES);
    });

    it('has the official service count', () => {
      expect(CATALOG_SERVICE_SEEDS).toHaveLength(CATALOG_COUNTS.SERVICES);
    });

    it('has unique slugs and valid category references', () => {
      const categorySlugs = new Set(CATALOG_CATEGORY_SEEDS.map((c) => c.slug));
      const serviceSlugs = new Set(CATALOG_SERVICE_SEEDS.map((s) => s.slug));
      expect(categorySlugs.size).toBe(CATALOG_CATEGORY_SEEDS.length);
      expect(serviceSlugs.size).toBe(CATALOG_SERVICE_SEEDS.length);
      for (const seed of CATALOG_SERVICE_SEEDS) {
        expect(categorySlugs.has(seed.categorySlug)).toBe(true);
      }
    });
  });

  describe('inactive filtering', () => {
    it('listCategories filters on isActive by default', async () => {
      prisma.serviceCategory.findMany.mockResolvedValue([category]);
      const result = await service.listCategories();
      expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
      expect(result[0].createdAt).toBe(now.toISOString());
    });

    it('listCategories can include inactive when activeOnly=false', async () => {
      prisma.serviceCategory.findMany.mockResolvedValue([]);
      await service.listCategories({ activeOnly: false });
      expect(prisma.serviceCategory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });

    it('listServices filters active services and categories, by category slug', async () => {
      prisma.service.findMany.mockResolvedValue([]);
      await service.listServices({ categorySlug: 'maison' });
      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            isActive: true,
            category: { isActive: true, slug: 'maison' },
          },
        }),
      );
    });

    it('listServices without activeOnly returns everything', async () => {
      prisma.service.findMany.mockResolvedValue([]);
      await service.listServices({ activeOnly: false });
      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('getServiceBySlug only looks up active services with active requirements', async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(service.getServiceBySlug('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.service.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: 'x', isActive: true },
          include: expect.objectContaining({
            requirements: expect.objectContaining({
              where: { isActive: true },
            }),
          }),
        }),
      );
    });

    it('getCategoryBySlug throws NotFound for inactive/missing category', async () => {
      prisma.serviceCategory.findFirst.mockResolvedValue(null);
      await expect(service.getCategoryBySlug('x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('admin', () => {
    it('createCategory maps unique violation to ConflictException', async () => {
      prisma.serviceCategory.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      await expect(
        service.createCategory({ name: 'A', slug: 'a' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('updateCategory deactivates softly via isActive=false', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValue(category);
      prisma.serviceCategory.update.mockResolvedValue({
        ...category,
        isActive: false,
      });
      const result = await service.updateCategory('c1', { isActive: false });
      expect(result.isActive).toBe(false);
    });

    it('createService requires an existing category', async () => {
      prisma.serviceCategory.findUnique.mockResolvedValue(null);
      await expect(
        service.createService({
          categoryId: 'missing',
          name: 'S',
          slug: 's',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('createRequirement requires an existing service', async () => {
      prisma.service.findUnique.mockResolvedValue(null);
      await expect(
        service.createRequirement('missing', {
          type: 'DOCUMENT',
          code: 'X',
          label: 'X',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
