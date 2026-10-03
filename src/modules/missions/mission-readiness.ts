import { ConflictException } from '@nestjs/common';
import {
  IdentityVerificationStatus,
  MissionPricingType,
  MissionSchedulingType,
  MissionStatus,
  UserStatus,
  type Mission,
  type PrismaClient,
} from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import { assertUserCanOperateAsClient } from '../verifications/operational-gates';

/** Validations objectives avant soumission paiement / revue / publication. */
type MissionReadinessDb = Pick<PrismaClient, 'user' | 'missionOccurrence'>;

export async function assertMissionReadyForReview(
  prisma: MissionReadinessDb,
  mission: Mission,
) {
  const client = await prisma.user.findUnique({
    where: { id: mission.clientUserId },
    select: {
      status: true,
      identityVerificationStatus: true,
      legalGuardianStatus: true,
    },
  });
  assertUserCanOperateAsClient(client);

  if (
    !mission.title?.trim() ||
    mission.title.trim().length < MISSION_LIMITS.TITLE_MIN
  ) {
    throw new ConflictException('Titre de mission insuffisant.');
  }
  if (mission.title.trim().length > MISSION_LIMITS.TITLE_MAX) {
    throw new ConflictException('Le titre ne peut pas dépasser 80 caractères.');
  }
  if (!mission.description?.trim() || mission.description.trim().length < 10) {
    throw new ConflictException('Description de mission insuffisante.');
  }
  if (!mission.city?.trim()) {
    throw new ConflictException('Ville requise.');
  }

  if (mission.workersNeeded < MISSION_LIMITS.MIN_WORKERS_NEEDED) {
    throw new ConflictException('Nombre de Jobbers invalide.');
  }

  if (mission.pricingType === MissionPricingType.FIXED) {
    if (mission.clientPriceAmount < MISSION_LIMITS.MIN_PRICE_XOF) {
      throw new ConflictException('Prix mission invalide.');
    }
  } else if (
    !mission.rateAmount ||
    mission.rateAmount < MISSION_LIMITS.MIN_PRICE_XOF
  ) {
    throw new ConflictException('Tarif horaire/journalier requis.');
  }

  const occurrenceCount = await prisma.missionOccurrence.count({
    where: { missionId: mission.id },
  });

  if (mission.schedulingType === MissionSchedulingType.SELECTED_DAYS) {
    const hasWeekdays = mission.selectedWeekdays.length > 0;
    const hasOccurrences = occurrenceCount > 0;
    if (!hasWeekdays && !hasOccurrences) {
      throw new ConflictException('Sélectionnez au moins un jour.');
    }
  }

  if (occurrenceCount === 0 && !mission.scheduledStartAt) {
    throw new ConflictException('Planning de mission incomplet.');
  }

  if (
    mission.status === MissionStatus.PENDING_REVIEW &&
    client?.identityVerificationStatus !== IdentityVerificationStatus.VERIFIED
  ) {
    throw new ConflictException(
      'Incohérence : Client non vérifié pour une mission en revue.',
    );
  }

  if (client?.status === UserStatus.SUSPENDED) {
    throw new ConflictException('Compte Client suspendu.');
  }
}

export function assertMissionEditableStatus(status: MissionStatus) {
  if (
    status !== MissionStatus.DRAFT &&
    status !== MissionStatus.NEEDS_CHANGES
  ) {
    throw new ConflictException(
      `La mission ne peut être modifiée que en DRAFT ou NEEDS_CHANGES (${status}).`,
    );
  }
}
