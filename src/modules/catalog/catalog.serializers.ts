import type {
  DocumentType,
  Service,
  ServiceCategory,
  ServiceRequirement,
} from '@prisma/client';

export type DocumentTypeBrief = {
  id: string;
  code: string;
  name: string;
};

export type CategoryResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  servicesCount?: number;
};

export type RequirementResponse = {
  id: string;
  serviceId: string;
  type: ServiceRequirement['type'];
  code: string;
  label: string;
  description: string | null;
  isRequired: boolean;
  isActive: boolean;
  documentTypeId: string | null;
  configuration: unknown;
  createdAt: string;
  updatedAt: string;
  documentType?: DocumentTypeBrief;
};

export type ServiceResponse = {
  id: string;
  categoryId: string;
  category?: CategoryResponse | { id: string; slug: string; name: string };
  name: string;
  slug: string;
  shortDescription: string | null;
  isActive: boolean;
  displayOrder: number;
  minimumAge: number;
  requirements?: RequirementResponse[];
  createdAt: string;
  updatedAt: string;
  jobberCount?: number;
  requirementsCount?: number;
};

export type AdminServiceBrief = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  minimumAge: number;
  displayOrder: number;
};

export type AdminCategoryDetailResponse = CategoryResponse & {
  servicesCount: number;
  services: AdminServiceBrief[];
};

export type DocumentTypeResponse = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export type AdminCatalogOverviewResponse = {
  categoriesTotal: number;
  categoriesActive: number;
  servicesTotal: number;
  servicesActive: number;
  servicesInactive: number;
  servicesAdult: number;
  requirementsActive: number;
  byCategory: Array<{
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    servicesCount: number;
  }>;
  attention?: Array<{ code: string; label: string; count: number }>;
};

export type AdminPaginatedServicesResponse = {
  items: ServiceResponse[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function serializeCategory(
  category: ServiceCategory & { _count?: { services: number } },
): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    displayOrder: category.displayOrder,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
    ...(category._count ? { servicesCount: category._count.services } : {}),
  };
}

export function serializeDocumentType(
  documentType: DocumentType,
): DocumentTypeResponse {
  return {
    id: documentType.id,
    code: documentType.code,
    name: documentType.name,
    description: documentType.description,
    isActive: documentType.isActive,
  };
}

export function serializeRequirement(
  requirement: ServiceRequirement & {
    documentType?: Pick<DocumentType, 'id' | 'code' | 'name'> | null;
  },
): RequirementResponse {
  return {
    id: requirement.id,
    serviceId: requirement.serviceId,
    type: requirement.type,
    code: requirement.code,
    label: requirement.label,
    description: requirement.description,
    isRequired: requirement.isRequired,
    isActive: requirement.isActive,
    documentTypeId: requirement.documentTypeId,
    configuration: requirement.configuration,
    createdAt: requirement.createdAt.toISOString(),
    updatedAt: requirement.updatedAt.toISOString(),
    ...(requirement.documentType
      ? {
          documentType: {
            id: requirement.documentType.id,
            code: requirement.documentType.code,
            name: requirement.documentType.name,
          },
        }
      : {}),
  };
}

export function serializeService(
  service: Service & {
    category?:
      Pick<ServiceCategory, 'id' | 'slug' | 'name'> | ServiceCategory | null;
    requirements?: (ServiceRequirement & {
      documentType?: Pick<DocumentType, 'id' | 'code' | 'name'> | null;
    })[];
    _count?: { jobberServices: number; requirements: number };
  },
  options: { fullCategory?: boolean } = {},
): ServiceResponse {
  const categoryPayload = service.category
    ? options.fullCategory && 'createdAt' in service.category
      ? serializeCategory(service.category)
      : {
          id: service.category.id,
          slug: service.category.slug,
          name: service.category.name,
        }
    : undefined;

  return {
    id: service.id,
    categoryId: service.categoryId,
    ...(categoryPayload ? { category: categoryPayload } : {}),
    name: service.name,
    slug: service.slug,
    shortDescription: service.shortDescription,
    isActive: service.isActive,
    displayOrder: service.displayOrder,
    minimumAge: service.minimumAge,
    ...(service.requirements
      ? { requirements: service.requirements.map(serializeRequirement) }
      : {}),
    createdAt: service.createdAt.toISOString(),
    updatedAt: service.updatedAt.toISOString(),
    ...(service._count
      ? {
          jobberCount: service._count.jobberServices,
          requirementsCount: service._count.requirements,
        }
      : {}),
  };
}

export function toAdminServiceBrief(
  service: Pick<
    Service,
    'id' | 'name' | 'slug' | 'isActive' | 'minimumAge' | 'displayOrder'
  >,
): AdminServiceBrief {
  return {
    id: service.id,
    name: service.name,
    slug: service.slug,
    isActive: service.isActive,
    minimumAge: service.minimumAge,
    displayOrder: service.displayOrder,
  };
}
