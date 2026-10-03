import { Injectable } from '@nestjs/common';
import {
  JobberServiceStatus,
  JobberStatus,
  LegalGuardianStatus,
  ServiceRequirementType,
  UserStatus,
  type JobberProfile,
  type Service,
  type ServiceRequirement,
  type User,
} from '@prisma/client';
import { calculateAge, isMinor } from '../../common/utils/age';

export type EligibilityReason = {
  code: string;
  message: string;
};

export type EligibilityResult = {
  eligible: boolean;
  status: JobberServiceStatus;
  reasons: EligibilityReason[];
};

type EligibilityContext = {
  user: Pick<
    User,
    | 'status'
    | 'dateOfBirth'
    | 'legalGuardianStatus'
    | 'emailVerifiedAt'
    | 'phoneVerifiedAt'
  >;
  jobber: Pick<JobberProfile, 'status'>;
  service: Pick<Service, 'id' | 'slug' | 'isActive' | 'minimumAge' | 'name'>;
  requirements: Array<
    Pick<
      ServiceRequirement,
      'type' | 'code' | 'label' | 'isRequired' | 'isActive' | 'documentTypeId'
    >
  >;
  /**
   * DocumentType.id déjà APPROVED pour l'utilisateur.
   * Satisfait les exigences DOCUMENT obligatoires (éligibilité par service).
   */
  approvedDocumentTypeIds?: ReadonlySet<string>;
  now?: Date;
};

/**
 * Moteur d'éligibilité Jobber ↔ Service (Backend 03).
 * Autoritaire côté backend — le client ne peut pas forcer ELIGIBLE.
 *
 * Règles non encore vérifiables (documents, qualifications, validation manuelle)
 * → jamais considérées comme satisfaites silencieusement.
 */
@Injectable()
export class JobberEligibilityService {
  evaluate(ctx: EligibilityContext): EligibilityResult {
    const reasons: EligibilityReason[] = [];
    const now = ctx.now ?? new Date();
    const age = ctx.user.dateOfBirth
      ? calculateAge(ctx.user.dateOfBirth, now)
      : null;

    if (ctx.user.status !== UserStatus.ACTIVE) {
      reasons.push({
        code: 'USER_NOT_ACTIVE',
        message: 'Le compte utilisateur n’est pas actif.',
      });
    }

    if (
      ctx.jobber.status === JobberStatus.SUSPENDED ||
      ctx.jobber.status === JobberStatus.REJECTED
    ) {
      reasons.push({
        code: 'JOBBER_STATUS_BLOCKED',
        message: 'Le profil Jobber est suspendu ou refusé.',
      });
    }

    if (!ctx.service.isActive) {
      reasons.push({
        code: 'SERVICE_INACTIVE',
        message: 'Ce service n’est pas disponible actuellement.',
      });
    }

    if (age === null || age < ctx.service.minimumAge) {
      reasons.push({
        code: 'MINIMUM_AGE_NOT_MET',
        message:
          age === null
            ? 'La date de naissance est requise pour vérifier l’âge minimum de ce service.'
            : `L’âge minimum requis pour ce service (${ctx.service.minimumAge} ans) n’est pas atteint.`,
      });
    }

    const activeRequirements = ctx.requirements.filter((r) => r.isActive);
    let hasPendingRequirement = false;

    for (const requirement of activeRequirements) {
      if (
        requirement.type === ServiceRequirementType.MINIMUM_AGE &&
        (age === null || age < ctx.service.minimumAge)
      ) {
        // déjà couvert via service.minimumAge
        continue;
      }

      if (requirement.type === ServiceRequirementType.LEGAL_GUARDIAN_APPROVAL) {
        if (!isMinor(ctx.user.dateOfBirth, now)) {
          continue;
        }
        if (ctx.user.legalGuardianStatus !== LegalGuardianStatus.APPROVED) {
          hasPendingRequirement = true;
          reasons.push({
            code: 'LEGAL_GUARDIAN_APPROVAL_REQUIRED',
            message:
              'Une autorisation du représentant légal est requise pour ce service.',
          });
        }
        continue;
      }

      if (requirement.type === ServiceRequirementType.DOCUMENT) {
        if (!requirement.isRequired) {
          continue;
        }
        const approved = Boolean(
          requirement.documentTypeId &&
          ctx.approvedDocumentTypeIds?.has(requirement.documentTypeId),
        );
        if (approved) {
          continue;
        }
        hasPendingRequirement = true;
        reasons.push({
          code: 'DOCUMENT_REQUIREMENT_MISSING',
          message: `Un document est requis pour proposer vos services comme ${ctx.service.name} : ${requirement.label}.`,
        });
        continue;
      }

      if (
        requirement.type === ServiceRequirementType.QUALIFICATION ||
        requirement.type === ServiceRequirementType.MANUAL_APPROVAL
      ) {
        if (!requirement.isRequired) {
          continue;
        }
        hasPendingRequirement = true;
        reasons.push({
          code: 'PENDING_REQUIREMENT',
          message: `Exigence non encore vérifiable : ${requirement.label}.`,
        });
      }
    }

    const hardBlocked = reasons.some((r) =>
      [
        'USER_NOT_ACTIVE',
        'JOBBER_STATUS_BLOCKED',
        'SERVICE_INACTIVE',
        'MINIMUM_AGE_NOT_MET',
      ].includes(r.code),
    );

    if (hardBlocked) {
      return {
        eligible: false,
        status: JobberServiceStatus.RESTRICTED,
        reasons,
      };
    }

    if (hasPendingRequirement || reasons.length > 0) {
      return {
        eligible: false,
        status: JobberServiceStatus.PENDING_ELIGIBILITY,
        reasons,
      };
    }

    return {
      eligible: true,
      status: JobberServiceStatus.ELIGIBLE,
      reasons: [],
    };
  }

  mapStatusFromEligibility(result: EligibilityResult): JobberServiceStatus {
    return result.status;
  }
}
