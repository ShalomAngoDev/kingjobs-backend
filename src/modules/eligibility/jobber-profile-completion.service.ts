import { Injectable } from '@nestjs/common';
import type { JobberProfile, User } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export type ProfileCompletionResult = {
  percentage: number;
  missing: string[];
  completed: string[];
};

type ProfileWithRelations = JobberProfile & {
  user: Pick<
    User,
    'phoneVerifiedAt' | 'emailVerifiedAt' | 'firstName' | 'lastName'
  >;
  _count: {
    services: number;
    serviceAreas: number;
  };
};

/**
 * Complétion profil Jobber — calcul dérivé (non stocké).
 */
@Injectable()
export class JobberProfileCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  async computeForUser(userId: string): Promise<ProfileCompletionResult> {
    const profile = await this.prisma.jobberProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            phoneVerifiedAt: true,
            emailVerifiedAt: true,
            firstName: true,
            lastName: true,
          },
        },
        _count: {
          select: {
            services: true,
            serviceAreas: { where: { isActive: true } },
          },
        },
      },
    });

    if (!profile) {
      return {
        percentage: 0,
        missing: ['JOBBER_PROFILE'],
        completed: [],
      };
    }

    return this.compute(profile);
  }

  compute(profile: ProfileWithRelations): ProfileCompletionResult {
    const checks: Array<{ code: string; ok: boolean }> = [
      {
        code: 'IDENTITY',
        ok: Boolean(profile.user.firstName && profile.user.lastName),
      },
      {
        code: 'PHONE_VERIFIED',
        ok: Boolean(profile.user.phoneVerifiedAt),
      },
      {
        code: 'JOBBER_ACTIVATED',
        ok: true,
      },
      {
        code: 'BIO',
        ok: Boolean(profile.bio && profile.bio.trim().length >= 20),
      },
      {
        code: 'SERVICE',
        ok: profile._count.services >= 1,
      },
      {
        code: 'SERVICE_AREA',
        ok: profile._count.serviceAreas >= 1,
      },
    ];

    const completed = checks.filter((c) => c.ok).map((c) => c.code);
    const missing = checks.filter((c) => !c.ok).map((c) => c.code);
    const percentage = Math.round((completed.length / checks.length) * 100);

    return { percentage, missing, completed };
  }
}
