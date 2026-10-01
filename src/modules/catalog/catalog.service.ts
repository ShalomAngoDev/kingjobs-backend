import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { CATALOG_LIMITS } from '../../common/constants/catalog-limits';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  serializeCategory,
  serializeRequirement,
  serializeService,
} from './catalog.serializers';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { CreateRequirementDto } from './dto/create-requirement.dto';
import type { CreateServiceDto } from './dto/create-service.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { UpdateRequirementDto } from './dto/update-requirement.dto';
import type { UpdateServiceDto } from './dto/update-service.dto';

const categoryOrder: Prisma.ServiceCategoryOrderByWithRelationInput[] = [
  { displayOrder: 'asc' },
  { name: 'asc' },
];
const serviceOrder: Prisma.ServiceOrderByWithRelationInput[] = [
  { displayOrder: 'asc' },
  { name: 'asc' },
];
const categorySelect = { id: true, slug: true, name: true } as const;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Lecture publique ----------

  async listCategories(options: { activeOnly?: boolean } = {}) {
    const activeOnly = options.activeOnly ?? true;
    const categories = await this.prisma.serviceCategory.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: categoryOrder,
    });
    return categories.map(serializeCategory);
  }

  async getCategoryBySlug(slug: string) {
    const category = await this.prisma.serviceCategory.findFirst({
      where: { slug, isActive: true },
    });
    if (!category) {
      throw new NotFoundException('Catégorie introuvable');
    }
    return serializeCategory(category);
  }

  async listServices(
    options: { categorySlug?: string; activeOnly?: boolean } = {},
  ) {
    const activeOnly = options.activeOnly ?? true;
    const where: Prisma.ServiceWhereInput = {};
    if (activeOnly) {
      where.isActive = true;
      where.category = { isActive: true };
    }
    if (options.categorySlug) {
      where.category = {
        ...(where.category as object),
        slug: options.categorySlug,
      };
    }
    const services = await this.prisma.service.findMany({
      where,
      include: { category: { select: categorySelect } },
      orderBy: serviceOrder,
    });
    return services.map(serializeService);
  }

  async getServiceBySlug(slug: string) {
    const service = await this.prisma.service.findFirst({
      where: { slug, isActive: true },
      include: {
        category: { select: categorySelect },
        requirements: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!service) {
      throw new NotFoundException('Service introuvable');
    }
    return serializeService(service);
  }

  // ---------- Administration : catégories ----------

  async createCategory(dto: CreateCategoryDto) {
    try {
      const category = await this.prisma.serviceCategory.create({
        data: {
          id: randomUUID(),
          name: dto.name.trim(),
          slug: dto.slug,
          description: dto.description?.trim() || null,
          displayOrder: dto.displayOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
      });
      return serializeCategory(category);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce slug de catégorie existe déjà');
      }
      throw error;
    }
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    await this.requireCategory(id);
    try {
      const category = await this.prisma.serviceCategory.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          slug: dto.slug,
          description:
            dto.description === undefined
              ? undefined
              : dto.description.trim() || null,
          displayOrder: dto.displayOrder,
          isActive: dto.isActive,
        },
      });
      return serializeCategory(category);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce slug de catégorie existe déjà');
      }
      throw error;
    }
  }

  // ---------- Administration : services ----------

  async createService(dto: CreateServiceDto) {
    await this.requireCategory(dto.categoryId);
    try {
      const service = await this.prisma.service.create({
        data: {
          id: randomUUID(),
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          slug: dto.slug,
          shortDescription: dto.shortDescription?.trim() || null,
          displayOrder: dto.displayOrder ?? 0,
          minimumAge: dto.minimumAge ?? CATALOG_LIMITS.DEFAULT_MINIMUM_AGE,
          isActive: dto.isActive ?? true,
        },
        include: { category: { select: categorySelect } },
      });
      return serializeService(service);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce slug de service existe déjà');
      }
      throw error;
    }
  }

  async updateService(id: string, dto: UpdateServiceDto) {
    await this.requireService(id);
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    try {
      const service = await this.prisma.service.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          name: dto.name?.trim(),
          slug: dto.slug,
          shortDescription:
            dto.shortDescription === undefined
              ? undefined
              : dto.shortDescription.trim() || null,
          displayOrder: dto.displayOrder,
          minimumAge: dto.minimumAge,
          isActive: dto.isActive,
        },
        include: { category: { select: categorySelect } },
      });
      return serializeService(service);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce slug de service existe déjà');
      }
      throw error;
    }
  }

  // ---------- Administration : exigences ----------

  async createRequirement(serviceId: string, dto: CreateRequirementDto) {
    await this.requireService(serviceId);
    if (dto.documentTypeId) {
      await this.requireDocumentType(dto.documentTypeId);
    }
    try {
      const requirement = await this.prisma.serviceRequirement.create({
        data: {
          id: randomUUID(),
          serviceId,
          type: dto.type,
          code: dto.code,
          label: dto.label.trim(),
          description: dto.description?.trim() || null,
          isRequired: dto.isRequired ?? true,
          isActive: dto.isActive ?? true,
          documentTypeId: dto.documentTypeId ?? null,
          configuration: dto.configuration
            ? (dto.configuration as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return serializeRequirement(requirement);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Une exigence avec ce code existe déjà pour ce service',
        );
      }
      throw error;
    }
  }

  async updateRequirement(id: string, dto: UpdateRequirementDto) {
    const existing = await this.prisma.serviceRequirement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Exigence introuvable');
    }
    if (dto.documentTypeId) {
      await this.requireDocumentType(dto.documentTypeId);
    }
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Aucune modification fournie');
    }
    try {
      const requirement = await this.prisma.serviceRequirement.update({
        where: { id },
        data: {
          type: dto.type,
          code: dto.code,
          label: dto.label?.trim(),
          description:
            dto.description === undefined
              ? undefined
              : dto.description.trim() || null,
          isRequired: dto.isRequired,
          isActive: dto.isActive,
          documentTypeId: dto.documentTypeId,
          configuration: dto.configuration
            ? (dto.configuration as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return serializeRequirement(requirement);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Une exigence avec ce code existe déjà pour ce service',
        );
      }
      throw error;
    }
  }

  // ---------- Helpers ----------

  private async requireCategory(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException('Catégorie introuvable');
    }
    return category;
  }

  private async requireService(id: string) {
    const service = await this.prisma.service.findUnique({ where: { id } });
    if (!service) {
      throw new NotFoundException('Service introuvable');
    }
    return service;
  }

  private async requireDocumentType(id: string) {
    const documentType = await this.prisma.documentType.findUnique({
      where: { id },
    });
    if (!documentType) {
      throw new BadRequestException('Type de document introuvable');
    }
    return documentType;
  }
}
