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
  serializeDocumentType,
  serializeRequirement,
  serializeService,
  toAdminServiceBrief,
  type AdminCatalogOverviewResponse,
  type AdminPaginatedServicesResponse,
  type DocumentTypeResponse,
} from './catalog.serializers';
import type { AdminListCategoriesQueryDto } from './dto/admin-list-categories-query.dto';
import {
  ADMIN_CATALOG_DEFAULT_PAGE_SIZE,
  ADMIN_CATALOG_MAX_PAGE_SIZE,
  type AdminListServicesQueryDto,
} from './dto/admin-list-services-query.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { CreateRequirementDto } from './dto/create-requirement.dto';
import type { CreateServiceDto } from './dto/create-service.dto';
import type { CreateDocumentTypeDto } from './dto/document-type.dto';
import type { ListDocumentTypesQueryDto } from './dto/document-type.dto';
import type { UpdateDocumentTypeDto } from './dto/document-type.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';
import type { UpdateRequirementDto } from './dto/update-requirement.dto';
import type { UpdateServiceDto } from './dto/update-service.dto';
import {
  documentTypeCodeFromName,
  IDENTITY_DOCUMENT_TYPE_CODES,
  isIdentityDocumentTypeCode,
  normalizeDocumentTypeName,
} from './document-type.util';

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
    return services.map((row) => serializeService(row));
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

  // ---------- Administration : lecture ----------

  async getAdminCatalogOverview(): Promise<AdminCatalogOverviewResponse> {
    const [
      categoriesTotal,
      categoriesActive,
      servicesTotal,
      servicesActive,
      servicesInactive,
      servicesAdult,
      requirementsActive,
      missingDescriptionCount,
      categoriesWithCount,
    ] = await Promise.all([
      this.prisma.serviceCategory.count(),
      this.prisma.serviceCategory.count({ where: { isActive: true } }),
      this.prisma.service.count(),
      this.prisma.service.count({ where: { isActive: true } }),
      this.prisma.service.count({ where: { isActive: false } }),
      this.prisma.service.count({ where: { minimumAge: { gte: 18 } } }),
      this.prisma.serviceRequirement.count({ where: { isActive: true } }),
      this.prisma.service.count({
        where: {
          OR: [{ shortDescription: null }, { shortDescription: '' }],
        },
      }),
      this.prisma.serviceCategory.findMany({
        orderBy: categoryOrder,
        include: { _count: { select: { services: true } } },
      }),
    ]);

    const attention: AdminCatalogOverviewResponse['attention'] = [];
    if (missingDescriptionCount > 0) {
      attention.push({
        code: 'missingDescription',
        label: 'Description courte manquante',
        count: missingDescriptionCount,
      });
    }

    const overview: AdminCatalogOverviewResponse = {
      categoriesTotal,
      categoriesActive,
      servicesTotal,
      servicesActive,
      servicesInactive,
      servicesAdult,
      requirementsActive,
      byCategory: categoriesWithCount.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        isActive: category.isActive,
        servicesCount: category._count.services,
      })),
    };

    if (attention.length > 0) {
      overview.attention = attention;
    }

    return overview;
  }

  async adminListCategories(query: AdminListCategoriesQueryDto) {
    const where: Prisma.ServiceCategoryWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    const categories = await this.prisma.serviceCategory.findMany({
      where,
      orderBy: categoryOrder,
      include: { _count: { select: { services: true } } },
    });
    return categories.map(serializeCategory);
  }

  async adminGetCategoryById(id: string) {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id },
      include: {
        _count: { select: { services: true } },
        services: {
          orderBy: serviceOrder,
          select: {
            id: true,
            name: true,
            slug: true,
            isActive: true,
            minimumAge: true,
            displayOrder: true,
          },
        },
      },
    });
    if (!category) {
      throw new NotFoundException('Catégorie introuvable');
    }
    return {
      ...serializeCategory(category),
      servicesCount: category._count.services,
      services: category.services.map(toAdminServiceBrief),
    };
  }

  async adminListServices(
    query: AdminListServicesQueryDto,
  ): Promise<AdminPaginatedServicesResponse> {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? ADMIN_CATALOG_DEFAULT_PAGE_SIZE,
      ADMIN_CATALOG_MAX_PAGE_SIZE,
    );
    const where = this.buildAdminServicesWhere(query);

    const [total, services] = await Promise.all([
      this.prisma.service.count({ where }),
      this.prisma.service.findMany({
        where,
        include: {
          category: { select: categorySelect },
          _count: {
            select: {
              jobberServices: true,
              requirements: { where: { isActive: true } },
            },
          },
        },
        orderBy: serviceOrder,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: services.map((service) => serializeService(service)),
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async adminGetServiceById(id: string) {
    const service = await this.prisma.service.findUnique({
      where: { id },
      include: {
        category: true,
        requirements: {
          orderBy: { createdAt: 'asc' },
          include: {
            documentType: { select: { id: true, code: true, name: true } },
          },
        },
        _count: { select: { jobberServices: true } },
      },
    });
    if (!service) {
      throw new NotFoundException('Service introuvable');
    }
    const { _count, ...rest } = service;
    return {
      ...serializeService(rest, { fullCategory: true }),
      jobberCount: _count.jobberServices,
    };
  }

  async adminListDocumentTypes(
    query: ListDocumentTypesQueryDto = {},
  ): Promise<DocumentTypeResponse[]> {
    const professionalOnly = query.professionalOnly !== false;
    const includeInactive = query.includeInactive === true;
    const where: Prisma.DocumentTypeWhereInput = {};
    if (!includeInactive) {
      where.isActive = true;
    }
    if (professionalOnly) {
      where.code = { notIn: [...IDENTITY_DOCUMENT_TYPE_CODES] };
    }
    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
      ];
    }
    const documentTypes = await this.prisma.documentType.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });
    return documentTypes.map(serializeDocumentType);
  }

  /**
   * Crée un DocumentType global depuis un libellé Admin (code généré).
   * Dédoublonne sur code et nom normalisé.
   */
  async createDocumentType(dto: CreateDocumentTypeDto) {
    const name = dto.name.trim();
    if (name.length < 2) {
      throw new BadRequestException('Le nom du document est trop court.');
    }
    const code = documentTypeCodeFromName(name);
    if (isIdentityDocumentTypeCode(code)) {
      throw new BadRequestException(
        'Ce type correspond à un document d’identité global ; il ne peut pas être créé ici.',
      );
    }

    const existingByCode = await this.prisma.documentType.findUnique({
      where: { code },
    });
    if (existingByCode) {
      if (!existingByCode.isActive) {
        const reactivated = await this.prisma.documentType.update({
          where: { id: existingByCode.id },
          data: {
            isActive: true,
            name,
            description: dto.description?.trim() || existingByCode.description,
          },
        });
        return {
          ...serializeDocumentType(reactivated),
          reused: true as const,
        };
      }
      return {
        ...serializeDocumentType(existingByCode),
        reused: true as const,
      };
    }

    const all = await this.prisma.documentType.findMany({
      select: { id: true, name: true, code: true, isActive: true, description: true, createdAt: true, updatedAt: true },
    });
    const normalized = normalizeDocumentTypeName(name);
    const byName = all.find(
      (row) => normalizeDocumentTypeName(row.name) === normalized,
    );
    if (byName) {
      if (!byName.isActive) {
        const reactivated = await this.prisma.documentType.update({
          where: { id: byName.id },
          data: {
            isActive: true,
            name,
            description: dto.description?.trim() || byName.description,
          },
        });
        return {
          ...serializeDocumentType(reactivated),
          reused: true as const,
        };
      }
      return { ...serializeDocumentType(byName), reused: true as const };
    }

    try {
      const created = await this.prisma.documentType.create({
        data: {
          id: randomUUID(),
          code,
          name,
          description: dto.description?.trim() || null,
          isActive: true,
        },
      });
      return { ...serializeDocumentType(created), reused: false as const };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.documentType.findUnique({
          where: { code },
        });
        if (again) {
          return { ...serializeDocumentType(again), reused: true as const };
        }
        throw new ConflictException('Ce type de document existe déjà');
      }
      throw error;
    }
  }

  async updateDocumentType(id: string, dto: UpdateDocumentTypeDto) {
    const existing = await this.prisma.documentType.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Type de document introuvable');
    }
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('Aucune modification fournie');
    }

    if (dto.isActive === false) {
      const activeUsage = await this.prisma.serviceRequirement.count({
        where: {
          documentTypeId: id,
          isActive: true,
        },
      });
      if (activeUsage > 0) {
        throw new ConflictException(
          `Ce type est utilisé par ${activeUsage} exigence(s) active(s). Désactivez d’abord ces exigences.`,
        );
      }
    }

    const updated = await this.prisma.documentType.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        isActive: dto.isActive,
      },
    });
    return serializeDocumentType(updated);
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
    let documentTypeId = dto.documentTypeId ?? null;
    let label = dto.label?.trim() ?? '';
    let code = dto.code?.trim() ?? '';

    if (dto.type === 'DOCUMENT') {
      if (!documentTypeId) {
        throw new BadRequestException(
          'documentTypeId est obligatoire pour une exigence DOCUMENT.',
        );
      }
      const documentType = await this.requireDocumentType(documentTypeId);
      if (isIdentityDocumentTypeCode(documentType.code)) {
        throw new BadRequestException(
          'Les documents d’identité globaux ne se configurent pas comme exigence de service.',
        );
      }
      if (!label) label = documentType.name;
      if (!code?.trim()) {
        code = `DOC_${documentType.code}`.slice(0, 80);
      }
      documentTypeId = documentType.id;
    } else {
      if (!code?.trim() || !label?.trim()) {
        throw new BadRequestException(
          'code et label sont obligatoires pour ce type d’exigence.',
        );
      }
      if (documentTypeId) {
        await this.requireDocumentType(documentTypeId);
      }
    }

    try {
      const requirement = await this.prisma.serviceRequirement.create({
        data: {
          id: randomUUID(),
          serviceId,
          type: dto.type,
          code,
          label,
          description: dto.description?.trim() || null,
          isRequired: dto.isRequired ?? true,
          isActive: dto.isActive ?? true,
          documentTypeId,
          configuration: dto.configuration
            ? (dto.configuration as Prisma.InputJsonValue)
            : undefined,
        },
        include: {
          documentType: { select: { id: true, code: true, name: true } },
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

  private buildAdminServicesWhere(
    query: AdminListServicesQueryDto,
  ): Prisma.ServiceWhereInput {
    const where: Prisma.ServiceWhereInput = {};
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { slug: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }
    if (query.status === 'active') {
      where.isActive = true;
    } else if (query.status === 'inactive') {
      where.isActive = false;
    }
    if (query.minAge === 16) {
      where.minimumAge = { lt: 18 };
    } else if (query.minAge === 18) {
      where.minimumAge = { gte: 18 };
    }
    return where;
  }

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
