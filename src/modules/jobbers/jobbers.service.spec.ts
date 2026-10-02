import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  JobberServiceStatus,
  JobberStatus,
  LegalGuardianStatus,
  UserStatus,
} from '@prisma/client';
import { CATALOG_LIMITS } from '../../common/constants/catalog-limits';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JobberEligibilityService } from '../eligibility/jobber-eligibility.service';
import { JobberProfileCompletionService } from '../eligibility/jobber-profile-completion.service';
import { JobbersService, normalizeSkillName } from './jobbers.service';

describe('JobbersService', () => {
  const prisma = {
    jobberProfile: { findUnique: jest.fn(), update: jest.fn() },
    jobberService: {
      count: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    jobberServiceArea: {
      count: jest.fn(),
      create: jest.fn(),
    },
    jobberSkill: {
      count: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    service: { findFirst: jest.fn(), findUnique: jest.fn() },
    serviceRequirement: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const eligibility = {
    evaluate: jest.fn(),
  } as unknown as JobberEligibilityService;
  const completion = {
    computeForUser: jest.fn(),
  } as unknown as JobberProfileCompletionService;

  const service = new JobbersService(
    prisma as unknown as PrismaService,
    eligibility,
    completion,
    {
      loadApprovedDocumentTypeIds: jest.fn().mockResolvedValue(new Set()),
      recomputeForUser: jest.fn().mockResolvedValue(undefined),
      getDocumentRequirementsSummary: jest.fn(),
    } as never,
  );

  const now = new Date('2026-10-01T00:00:00.000Z');
  const profile = {
    id: 'jp1',
    userId: 'u1',
    status: JobberStatus.ACTIVE,
    headline: null,
    bio: null,
    yearsOfExperience: null,
    createdAt: now,
    updatedAt: now,
  };
  const catalogService = {
    id: 's1',
    slug: 'menage',
    name: 'Ménage',
    isActive: true,
    minimumAge: 16,
    categoryId: 'c1',
  };
  const user = {
    status: UserStatus.ACTIVE,
    dateOfBirth: new Date('1995-01-01'),
    legalGuardianStatus: LegalGuardianStatus.NOT_REQUIRED,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.jobberProfile.findUnique.mockResolvedValue(profile);
    prisma.jobberService.count.mockResolvedValue(0);
  });

  it('requireJobberProfile throws Forbidden when profile is missing', async () => {
    prisma.jobberProfile.findUnique.mockResolvedValue(null);
    await expect(service.requireJobberProfile('u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  describe('addService', () => {
    it('rejects when MAX_JOBBER_SERVICES is reached', async () => {
      prisma.jobberService.count.mockResolvedValue(
        CATALOG_LIMITS.MAX_JOBBER_SERVICES,
      );
      await expect(
        service.addService('u1', { serviceId: 's1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.service.findFirst).not.toHaveBeenCalled();
    });

    it('rejects an inactive or unknown service', async () => {
      prisma.service.findFirst.mockResolvedValue(null);
      await expect(
        service.addService('u1', { serviceId: 's1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.service.findFirst).toHaveBeenCalledWith({
        where: { id: 's1', isActive: true },
      });
      expect(prisma.jobberService.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate service', async () => {
      prisma.service.findFirst.mockResolvedValue(catalogService);
      prisma.jobberService.findUnique.mockResolvedValue({ id: 'js1' });
      await expect(
        service.addService('u1', { serviceId: 's1' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.jobberService.create).not.toHaveBeenCalled();
    });

    it('creates with the status computed by the eligibility engine', async () => {
      prisma.service.findFirst.mockResolvedValue(catalogService);
      prisma.jobberService.findUnique.mockResolvedValue(null);
      prisma.serviceRequirement.findMany.mockResolvedValue([]);
      prisma.user.findUnique.mockResolvedValue(user);
      (eligibility.evaluate as jest.Mock).mockReturnValue({
        eligible: false,
        status: JobberServiceStatus.PENDING_ELIGIBILITY,
        reasons: [{ code: 'PENDING_REQUIREMENT', message: 'x' }],
      });
      prisma.jobberService.create.mockImplementation(({ data }) =>
        Promise.resolve({
          ...data,
          createdAt: now,
          updatedAt: now,
          service: {
            ...catalogService,
            category: { id: 'c1', slug: 'm', name: 'M' },
          },
        }),
      );

      // un champ "status" envoyé par le client est ignoré
      const result = await service.addService('u1', {
        serviceId: 's1',
        yearsOfExperience: 3,
        status: JobberServiceStatus.ELIGIBLE,
      } as never);

      expect(eligibility.evaluate).toHaveBeenCalledTimes(1);
      expect(prisma.jobberService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: JobberServiceStatus.PENDING_ELIGIBILITY,
            yearsOfExperience: 3,
          }),
        }),
      );
      expect(result.status).toBe(JobberServiceStatus.PENDING_ELIGIBILITY);
      expect(result.eligibility.eligible).toBe(false);
    });
  });

  describe('areas', () => {
    it('rejects when MAX_JOBBER_SERVICE_AREAS is reached', async () => {
      prisma.jobberServiceArea.count.mockResolvedValue(
        CATALOG_LIMITS.MAX_JOBBER_SERVICE_AREAS,
      );
      await expect(
        service.addArea('u1', { city: 'Cotonou' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.jobberServiceArea.create).not.toHaveBeenCalled();
    });

    it('rejects latitude without longitude', async () => {
      await expect(
        service.addArea('u1', { city: 'Cotonou', latitude: 6.36 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('skills', () => {
    it('normalizes names', () => {
      expect(normalizeSkillName('  Plomberie   Générale ')).toBe(
        'plomberie générale',
      );
    });

    it('rejects when MAX_JOBBER_SKILLS is reached', async () => {
      prisma.jobberSkill.count.mockResolvedValue(
        CATALOG_LIMITS.MAX_JOBBER_SKILLS,
      );
      await expect(
        service.addSkill('u1', { name: 'Peinture' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate skill (same normalized name and scope)', async () => {
      prisma.jobberSkill.count.mockResolvedValue(0);
      prisma.jobberSkill.findUnique.mockResolvedValue({ id: 'k1' });
      await expect(
        service.addSkill('u1', { name: '  PEINTURE ' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.jobberSkill.findUnique).toHaveBeenCalledWith({
        where: {
          jobberProfileId_nameNormalized_scopeKey: {
            jobberProfileId: 'jp1',
            nameNormalized: 'peinture',
            scopeKey: 'profile',
          },
        },
      });
    });
  });
});
