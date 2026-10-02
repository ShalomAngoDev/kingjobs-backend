import {
  JobberServiceStatus,
  JobberStatus,
  LegalGuardianStatus,
  ServiceRequirementType,
  UserStatus,
} from '@prisma/client';
import { JobberEligibilityService } from './jobber-eligibility.service';

describe('JobberEligibilityService', () => {
  const service = new JobberEligibilityService();
  const now = new Date('2026-10-01T12:00:00.000Z');

  const baseUser = {
    status: UserStatus.ACTIVE,
    dateOfBirth: new Date('1995-01-01'),
    legalGuardianStatus: LegalGuardianStatus.NOT_REQUIRED,
    emailVerifiedAt: null,
    phoneVerifiedAt: null,
  };
  const baseService = {
    id: 's1',
    slug: 'menage',
    name: 'Ménage',
    isActive: true,
    minimumAge: 16,
  };
  const jobber = { status: JobberStatus.ACTIVE };

  const requirement = (
    overrides: Partial<{
      type: ServiceRequirementType;
      code: string;
      label: string;
      isRequired: boolean;
      isActive: boolean;
    }> = {},
  ) => ({
    type: ServiceRequirementType.DOCUMENT,
    code: 'DOC',
    label: 'Document',
    isRequired: true,
    isActive: true,
    documentTypeId: null,
    ...overrides,
  });

  it('returns ELIGIBLE for an adult with no requirements', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: baseService,
      requirements: [],
      now,
    });
    expect(result.eligible).toBe(true);
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
    expect(result.reasons).toHaveLength(0);
  });

  it('restricts when the user is under the service minimum age', () => {
    const result = service.evaluate({
      user: { ...baseUser, dateOfBirth: new Date('2012-01-01') },
      jobber,
      service: { ...baseService, minimumAge: 18 },
      requirements: [],
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe(JobberServiceStatus.RESTRICTED);
    expect(result.reasons.map((r) => r.code)).toContain('MINIMUM_AGE_NOT_MET');
  });

  it('is eligible exactly at the minimum age', () => {
    const result = service.evaluate({
      user: { ...baseUser, dateOfBirth: new Date('2010-10-01') },
      jobber,
      service: { ...baseService, minimumAge: 16 },
      requirements: [],
      now,
    });
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
  });

  it('is pending when a minor lacks legal guardian approval', () => {
    const result = service.evaluate({
      user: {
        ...baseUser,
        dateOfBirth: new Date('2009-06-01'),
        legalGuardianStatus: LegalGuardianStatus.PENDING,
      },
      jobber,
      service: baseService,
      requirements: [
        requirement({
          type: ServiceRequirementType.LEGAL_GUARDIAN_APPROVAL,
          code: 'GUARDIAN',
        }),
      ],
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe(JobberServiceStatus.PENDING_ELIGIBILITY);
    expect(result.reasons.map((r) => r.code)).toContain(
      'LEGAL_GUARDIAN_APPROVAL_REQUIRED',
    );
  });

  it('is eligible when a minor has guardian approval', () => {
    const result = service.evaluate({
      user: {
        ...baseUser,
        dateOfBirth: new Date('2009-06-01'),
        legalGuardianStatus: LegalGuardianStatus.APPROVED,
      },
      jobber,
      service: baseService,
      requirements: [
        requirement({
          type: ServiceRequirementType.LEGAL_GUARDIAN_APPROVAL,
          code: 'GUARDIAN',
        }),
      ],
      now,
    });
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
  });

  it('ignores the guardian requirement for adults', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: baseService,
      requirements: [
        requirement({
          type: ServiceRequirementType.LEGAL_GUARDIAN_APPROVAL,
          code: 'GUARDIAN',
        }),
      ],
      now,
    });
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
  });

  it.each([
    ServiceRequirementType.QUALIFICATION,
    ServiceRequirementType.MANUAL_APPROVAL,
  ])('keeps %s required requirement pending', (type) => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: baseService,
      requirements: [requirement({ type })],
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe(JobberServiceStatus.PENDING_ELIGIBILITY);
    expect(result.reasons.map((r) => r.code)).toContain('PENDING_REQUIREMENT');
  });

  it('keeps DOCUMENT requirement pending without approved document', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: { ...baseService, name: 'Chauffeur', slug: 'chauffeur' },
      requirements: [
        requirement({
          type: ServiceRequirementType.DOCUMENT,
          label: 'Permis de conduire',
          documentTypeId: 'dt-permis',
        }),
      ],
      approvedDocumentTypeIds: new Set(),
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe(JobberServiceStatus.PENDING_ELIGIBILITY);
    expect(result.reasons.map((r) => r.code)).toContain(
      'DOCUMENT_REQUIREMENT_MISSING',
    );
    expect(result.reasons[0]?.message).toContain('Chauffeur');
    expect(result.reasons[0]?.message).toContain('Permis de conduire');
  });

  it('is eligible when DOCUMENT requirement is APPROVED', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: { ...baseService, name: 'Chauffeur', slug: 'chauffeur' },
      requirements: [
        requirement({
          type: ServiceRequirementType.DOCUMENT,
          label: 'Permis de conduire',
          documentTypeId: 'dt-permis',
        }),
      ],
      approvedDocumentTypeIds: new Set(['dt-permis']),
      now,
    });
    expect(result.eligible).toBe(true);
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
  });

  it('ignores optional and inactive requirements', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: baseService,
      requirements: [
        requirement({ isRequired: false, documentTypeId: 'dt-x' }),
        requirement({ code: 'OLD', isActive: false, documentTypeId: 'dt-y' }),
      ],
      now,
    });
    expect(result.status).toBe(JobberServiceStatus.ELIGIBLE);
  });

  it('restricts when the service is inactive', () => {
    const result = service.evaluate({
      user: baseUser,
      jobber,
      service: { ...baseService, isActive: false },
      requirements: [],
      now,
    });
    expect(result.eligible).toBe(false);
    expect(result.status).toBe(JobberServiceStatus.RESTRICTED);
    expect(result.reasons.map((r) => r.code)).toContain('SERVICE_INACTIVE');
  });

  it('restricts suspended users and jobbers', () => {
    const suspendedUser = service.evaluate({
      user: { ...baseUser, status: UserStatus.SUSPENDED },
      jobber,
      service: baseService,
      requirements: [],
      now,
    });
    expect(suspendedUser.status).toBe(JobberServiceStatus.RESTRICTED);

    const suspendedJobber = service.evaluate({
      user: baseUser,
      jobber: { status: JobberStatus.SUSPENDED },
      service: baseService,
      requirements: [],
      now,
    });
    expect(suspendedJobber.status).toBe(JobberServiceStatus.RESTRICTED);
  });
});
