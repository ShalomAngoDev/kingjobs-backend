import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  JobberProfile,
  JobberServiceArea,
  JobberSkill,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { CATALOG_LIMITS } from '../../common/constants/catalog-limits';
import { isUniqueViolation } from '../../common/utils/prisma-errors';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  JobberEligibilityService,
  type EligibilityResult,
} from '../eligibility/jobber-eligibility.service';
import { JobberProfileCompletionService } from '../eligibility/jobber-profile-completion.service';
import type { AddJobberServiceDto } from './dto/add-jobber-service.dto';
import type { CreateJobberSkillDto } from './dto/create-jobber-skill.dto';
import type { CreateServiceAreaDto } from './dto/create-service-area.dto';
import type { UpdateJobberMeDto } from './dto/update-jobber-me.dto';
import type { UpdateJobberServiceDto } from './dto/update-jobber-service.dto';
import type { UpdateServiceAreaDto } from './dto/update-service-area.dto';

const eligibilityUserSelect = {
  status: true,
  dateOfBirth: true,
  legalGuardianStatus: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
} as const;

const jobberServiceInclude = {
  service: {
    include: { category: { select: { id: true, slug: true, name: true } } },
  },
} as const;

type JobberServiceWithService = Prisma.JobberServiceGetPayload<{
  include: typeof jobberServiceInclude;
}>;

/** nameNormalized : trim, minuscules, espaces multiples réduits. */
export function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

@Injectable()
export class JobbersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibilityService: JobberEligibilityService,
    private readonly completionService: JobberProfileCompletionService,
  ) {}

  async requireJobberProfile(userId: string): Promise<JobberProfile> {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
    });
    if (!profile) {
      throw new ForbiddenException('Profil Jobber non activé');
    }
    return profile;
  }

  // ---------- Profil ----------

  async getProfile(userId: string) {
    const profile = await this.requireJobberProfile(userId);
    return this.serializeProfile(profile);
  }

  async updateProfile(userId: string, dto: UpdateJobberMeDto) {
    await this.requireJobberProfile(userId);
    const updated = await this.prisma.jobberProfile.update({
      where: { userId },
      data: {
        bio: dto.bio === undefined ? undefined : dto.bio.trim() || null,
        headline:
          dto.headline === undefined ? undefined : dto.headline.trim() || null,
        yearsOfExperience: dto.yearsOfExperience,
      },
    });
    return this.serializeProfile(updated);
  }

  // ---------- Services du Jobber ----------

  async listMyServices(userId: string) {
    const profile = await this.requireJobberProfile(userId);
    const items = await this.prisma.jobberService.findMany({
      where: { jobberProfileId: profile.id },
      include: jobberServiceInclude,
      orderBy: { createdAt: 'asc' },
    });
    return items.map((item) => this.serializeJobberService(item));
  }

  async addService(userId: string, dto: AddJobberServiceDto) {
    const profile = await this.requireJobberProfile(userId);

    const count = await this.prisma.jobberService.count({
      where: { jobberProfileId: profile.id },
    });
    if (count >= CATALOG_LIMITS.MAX_JOBBER_SERVICES) {
      throw new BadRequestException(
        `Vous ne pouvez pas proposer plus de ${CATALOG_LIMITS.MAX_JOBBER_SERVICES} services`,
      );
    }

    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Service introuvable ou inactif');
    }

    const duplicate = await this.prisma.jobberService.findUnique({
      where: {
        jobberProfileId_serviceId: {
          jobberProfileId: profile.id,
          serviceId: service.id,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException('Ce service est déjà dans votre profil');
    }

    const requirements = await this.prisma.serviceRequirement.findMany({
      where: { serviceId: service.id, isActive: true },
    });
    const user = await this.loadEligibilityUser(userId);

    const result = this.eligibilityService.evaluate({
      user,
      jobber: { status: profile.status },
      service,
      requirements,
    });

    try {
      const created = await this.prisma.jobberService.create({
        data: {
          id: randomUUID(),
          jobberProfileId: profile.id,
          serviceId: service.id,
          experienceDescription: dto.experienceDescription?.trim() || null,
          yearsOfExperience: dto.yearsOfExperience ?? null,
          status: result.status,
        },
        include: jobberServiceInclude,
      });
      return {
        ...this.serializeJobberService(created),
        eligibility: this.serializeEligibility(result),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Ce service est déjà dans votre profil');
      }
      throw error;
    }
  }

  async updateService(
    userId: string,
    serviceId: string,
    dto: UpdateJobberServiceDto,
  ) {
    const profile = await this.requireJobberProfile(userId);
    const existing = await this.requireJobberService(profile.id, serviceId);

    const requirements = await this.prisma.serviceRequirement.findMany({
      where: { serviceId, isActive: true },
    });
    const user = await this.loadEligibilityUser(userId);
    const result = this.eligibilityService.evaluate({
      user,
      jobber: { status: profile.status },
      service: existing.service,
      requirements,
    });

    const updated = await this.prisma.jobberService.update({
      where: { id: existing.id },
      data: {
        experienceDescription:
          dto.experienceDescription === undefined
            ? undefined
            : dto.experienceDescription.trim() || null,
        yearsOfExperience: dto.yearsOfExperience,
        status: result.status,
      },
      include: jobberServiceInclude,
    });
    return {
      ...this.serializeJobberService(updated),
      eligibility: this.serializeEligibility(result),
    };
  }

  async removeService(userId: string, serviceId: string) {
    const profile = await this.requireJobberProfile(userId);
    const existing = await this.requireJobberService(profile.id, serviceId);
    await this.prisma.$transaction([
      this.prisma.jobberSkill.deleteMany({
        where: { jobberProfileId: profile.id, serviceId },
      }),
      this.prisma.jobberService.delete({ where: { id: existing.id } }),
    ]);
    return { message: 'Service retiré de votre profil' };
  }

  // ---------- Zones d'intervention ----------

  async listAreas(userId: string) {
    const profile = await this.requireJobberProfile(userId);
    const areas = await this.prisma.jobberServiceArea.findMany({
      where: { jobberProfileId: profile.id },
      orderBy: { createdAt: 'asc' },
    });
    return areas.map((area) => this.serializeArea(area));
  }

  async addArea(userId: string, dto: CreateServiceAreaDto) {
    const profile = await this.requireJobberProfile(userId);
    this.assertCoordinates(dto.latitude, dto.longitude);

    const count = await this.prisma.jobberServiceArea.count({
      where: { jobberProfileId: profile.id },
    });
    if (count >= CATALOG_LIMITS.MAX_JOBBER_SERVICE_AREAS) {
      throw new BadRequestException(
        `Vous ne pouvez pas définir plus de ${CATALOG_LIMITS.MAX_JOBBER_SERVICE_AREAS} zones d’intervention`,
      );
    }

    const area = await this.prisma.jobberServiceArea.create({
      data: {
        id: randomUUID(),
        jobberProfileId: profile.id,
        countryCode: dto.countryCode ?? CATALOG_LIMITS.DEFAULT_COUNTRY_CODE,
        administrativeArea: dto.administrativeArea?.trim() || null,
        city: dto.city.trim(),
        district: dto.district?.trim() || null,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        radiusKm: dto.radiusKm ?? null,
      },
    });
    return this.serializeArea(area);
  }

  async updateArea(userId: string, id: string, dto: UpdateServiceAreaDto) {
    const profile = await this.requireJobberProfile(userId);
    const existing = await this.requireArea(profile.id, id);

    const latitude =
      dto.latitude !== undefined
        ? dto.latitude
        : this.toNumber(existing.latitude);
    const longitude =
      dto.longitude !== undefined
        ? dto.longitude
        : this.toNumber(existing.longitude);
    this.assertCoordinates(latitude ?? undefined, longitude ?? undefined);

    const area = await this.prisma.jobberServiceArea.update({
      where: { id },
      data: {
        countryCode: dto.countryCode,
        administrativeArea:
          dto.administrativeArea === undefined
            ? undefined
            : dto.administrativeArea.trim() || null,
        city: dto.city?.trim(),
        district:
          dto.district === undefined ? undefined : dto.district.trim() || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        radiusKm: dto.radiusKm,
        isActive: dto.isActive,
      },
    });
    return this.serializeArea(area);
  }

  async removeArea(userId: string, id: string) {
    const profile = await this.requireJobberProfile(userId);
    await this.requireArea(profile.id, id);
    await this.prisma.jobberServiceArea.delete({ where: { id } });
    return { message: 'Zone d’intervention supprimée' };
  }

  // ---------- Compétences ----------

  async listSkills(userId: string) {
    const profile = await this.requireJobberProfile(userId);
    const skills = await this.prisma.jobberSkill.findMany({
      where: { jobberProfileId: profile.id },
      orderBy: { createdAt: 'asc' },
    });
    return skills.map((skill) => this.serializeSkill(skill));
  }

  async addSkill(userId: string, dto: CreateJobberSkillDto) {
    const profile = await this.requireJobberProfile(userId);

    const name = dto.name.trim().replace(/\s+/g, ' ');
    const nameNormalized = normalizeSkillName(dto.name);
    if (!nameNormalized) {
      throw new BadRequestException('Le nom de la compétence est requis');
    }

    const count = await this.prisma.jobberSkill.count({
      where: { jobberProfileId: profile.id },
    });
    if (count >= CATALOG_LIMITS.MAX_JOBBER_SKILLS) {
      throw new BadRequestException(
        `Vous ne pouvez pas ajouter plus de ${CATALOG_LIMITS.MAX_JOBBER_SKILLS} compétences`,
      );
    }

    if (dto.serviceId) {
      await this.requireJobberService(profile.id, dto.serviceId);
    }
    const scopeKey = dto.serviceId ?? 'profile';

    const duplicate = await this.prisma.jobberSkill.findUnique({
      where: {
        jobberProfileId_nameNormalized_scopeKey: {
          jobberProfileId: profile.id,
          nameNormalized,
          scopeKey,
        },
      },
    });
    if (duplicate) {
      throw new ConflictException('Cette compétence existe déjà');
    }

    try {
      const skill = await this.prisma.jobberSkill.create({
        data: {
          id: randomUUID(),
          jobberProfileId: profile.id,
          serviceId: dto.serviceId ?? null,
          scopeKey,
          name,
          nameNormalized,
        },
      });
      return this.serializeSkill(skill);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Cette compétence existe déjà');
      }
      throw error;
    }
  }

  async removeSkill(userId: string, id: string) {
    const profile = await this.requireJobberProfile(userId);
    const skill = await this.prisma.jobberSkill.findFirst({
      where: { id, jobberProfileId: profile.id },
    });
    if (!skill) {
      throw new NotFoundException('Compétence introuvable');
    }
    await this.prisma.jobberSkill.delete({ where: { id } });
    return { message: 'Compétence supprimée' };
  }

  // ---------- Éligibilité & complétion ----------

  async getEligibility(userId: string, serviceId?: string) {
    const profile = await this.requireJobberProfile(userId);
    const user = await this.loadEligibilityUser(userId);

    if (serviceId) {
      const service = await this.prisma.service.findUnique({
        where: { id: serviceId },
      });
      if (!service) {
        throw new NotFoundException('Service introuvable');
      }
      const requirements = await this.prisma.serviceRequirement.findMany({
        where: { serviceId, isActive: true },
      });
      const result = this.eligibilityService.evaluate({
        user,
        jobber: { status: profile.status },
        service,
        requirements,
      });
      return this.serializeServiceEligibility(service, result);
    }

    const items = await this.prisma.jobberService.findMany({
      where: { jobberProfileId: profile.id },
      include: {
        service: {
          include: {
            requirements: { where: { isActive: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return items.map((item) => {
      const result = this.eligibilityService.evaluate({
        user,
        jobber: { status: profile.status },
        service: item.service,
        requirements: item.service.requirements,
      });
      return this.serializeServiceEligibility(item.service, result);
    });
  }

  async getProfileCompletion(userId: string) {
    await this.requireJobberProfile(userId);
    return this.completionService.computeForUser(userId);
  }

  // ---------- Helpers ----------

  private async loadEligibilityUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: eligibilityUserSelect,
    });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    return user;
  }

  private async requireJobberService(
    jobberProfileId: string,
    serviceId: string,
  ) {
    const existing = await this.prisma.jobberService.findUnique({
      where: { jobberProfileId_serviceId: { jobberProfileId, serviceId } },
      include: { service: true },
    });
    if (!existing) {
      throw new NotFoundException('Service non présent dans votre profil');
    }
    return existing;
  }

  private async requireArea(jobberProfileId: string, id: string) {
    const area = await this.prisma.jobberServiceArea.findFirst({
      where: { id, jobberProfileId },
    });
    if (!area) {
      throw new NotFoundException('Zone d’intervention introuvable');
    }
    return area;
  }

  private assertCoordinates(
    latitude?: number | null,
    longitude?: number | null,
  ) {
    const hasLat = latitude !== undefined && latitude !== null;
    const hasLng = longitude !== undefined && longitude !== null;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'La latitude et la longitude doivent être fournies ensemble',
      );
    }
  }

  private toNumber(value: { toString(): string } | null | undefined) {
    return value === null || value === undefined ? null : Number(value);
  }

  private serializeProfile(profile: JobberProfile) {
    return {
      id: profile.id,
      status: profile.status,
      headline: profile.headline,
      bio: profile.bio,
      yearsOfExperience: profile.yearsOfExperience,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  private serializeJobberService(item: JobberServiceWithService) {
    return {
      id: item.id,
      serviceId: item.serviceId,
      service: {
        id: item.service.id,
        slug: item.service.slug,
        name: item.service.name,
        isActive: item.service.isActive,
        category: item.service.category,
      },
      experienceDescription: item.experienceDescription,
      yearsOfExperience: item.yearsOfExperience,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private serializeEligibility(result: EligibilityResult) {
    return {
      eligible: result.eligible,
      status: result.status,
      reasons: result.reasons,
    };
  }

  private serializeServiceEligibility(
    service: { id: string; slug: string; name: string },
    result: EligibilityResult,
  ) {
    return {
      serviceId: service.id,
      serviceSlug: service.slug,
      serviceName: service.name,
      ...this.serializeEligibility(result),
    };
  }

  private serializeArea(area: JobberServiceArea) {
    return {
      id: area.id,
      countryCode: area.countryCode,
      administrativeArea: area.administrativeArea,
      city: area.city,
      district: area.district,
      latitude: this.toNumber(area.latitude),
      longitude: this.toNumber(area.longitude),
      radiusKm: this.toNumber(area.radiusKm),
      isActive: area.isActive,
      createdAt: area.createdAt.toISOString(),
      updatedAt: area.updatedAt.toISOString(),
    };
  }

  private serializeSkill(skill: JobberSkill) {
    return {
      id: skill.id,
      name: skill.name,
      serviceId: skill.serviceId,
      createdAt: skill.createdAt.toISOString(),
      updatedAt: skill.updatedAt.toISOString(),
    };
  }
}
