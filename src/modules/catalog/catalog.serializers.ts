import type {
  Service,
  ServiceCategory,
  ServiceRequirement,
} from '@prisma/client';

export type CategoryResponse = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
};

export type ServiceResponse = {
  id: string;
  categoryId: string;
  category?: { id: string; slug: string; name: string };
  name: string;
  slug: string;
  shortDescription: string | null;
  isActive: boolean;
  displayOrder: number;
  minimumAge: number;
  requirements?: RequirementResponse[];
  createdAt: string;
  updatedAt: string;
};

export function serializeCategory(category: ServiceCategory): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    description: category.description,
    displayOrder: category.displayOrder,
    isActive: category.isActive,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function serializeRequirement(
  requirement: ServiceRequirement,
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
  };
}

export function serializeService(
  service: Service & {
    category?: Pick<ServiceCategory, 'id' | 'slug' | 'name'> | null;
    requirements?: ServiceRequirement[];
  },
): ServiceResponse {
  return {
    id: service.id,
    categoryId: service.categoryId,
    ...(service.category
      ? {
          category: {
            id: service.category.id,
            slug: service.category.slug,
            name: service.category.name,
          },
        }
      : {}),
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
  };
}
