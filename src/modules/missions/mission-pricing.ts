import { BadRequestException } from '@nestjs/common';
import {
  MissionPricingType,
  MissionRateScope,
  MissionSchedulingType,
} from '@prisma/client';
import { MISSION_LIMITS } from '../../common/constants/mission-limits';
import type { OccurrenceInput } from './mission-scheduling';

/** Commission KingJOBS V1 (points de base) : 15 % = 1500. Pas de module Payment ici. */
export const KINGJOBS_COMMISSION_BPS = 1500;

export type PricingInput = {
  pricingType: MissionPricingType;
  /** Montant saisi par le Client (FCFA entier) selon rateScope. */
  rateAmount: number;
  rateScope: MissionRateScope;
  workersNeeded: number;
  estimatedDurationMinutes?: number | null;
  durationKnown?: boolean;
  schedulingType?: MissionSchedulingType;
  /** Nombre de jours / occurrences (DAILY). Min 1. */
  dayCount?: number;
  occurrences?: OccurrenceInput[];
};

/**
 * Résultats calculés (pas tous persistés).
 * Persistés recommandés : rateAmount, rateScope, pricingType, estimatedAmount (= total),
 * clientPriceAmount (= total, legacy paiement).
 * Calculés à la lecture : workerGrossAmount, commission, workerNetAmount.
 */
export type PricingComputed = {
  pricingType: MissionPricingType;
  rateAmount: number;
  rateScope: MissionRateScope;
  workersNeeded: number;
  /** Montant brut pour UNE personne (estimation). */
  workerGrossAmount: number;
  /** Estimation totale Mission. */
  estimatedTotalAmount: number;
  /** Alias persisté (legacy) : = estimatedTotalAmount. */
  clientPriceAmount: number;
  estimatedAmount: number;
};

function assertPositiveAmount(label: string, value: number) {
  if (!Number.isInteger(value) || value < MISSION_LIMITS.MIN_PRICE_XOF) {
    throw new BadRequestException(
      `${label} : montant entier minimum ${MISSION_LIMITS.MIN_PRICE_XOF} FCFA.`,
    );
  }
  if (value > MISSION_LIMITS.MAX_PRICE_XOF) {
    throw new BadRequestException(`${label} : montant trop élevé.`);
  }
}

/** Somme des durées d'occurrences (minutes). Null si aucune durée exploitable. */
function sumOccurrenceMinutes(
  occurrences: OccurrenceInput[] | undefined,
): number | null {
  if (!occurrences?.length) return null;
  let total = 0;
  let any = false;
  for (const row of occurrences) {
    let minutes = row.estimatedDurationMinutes ?? null;
    if (
      minutes == null &&
      row.plannedStartAt &&
      row.plannedEndAt &&
      row.plannedEndAt.getTime() > row.plannedStartAt.getTime()
    ) {
      minutes = Math.round(
        (row.plannedEndAt.getTime() - row.plannedStartAt.getTime()) / 60_000,
      );
    }
    if (minutes != null && Number.isInteger(minutes) && minutes > 0) {
      total += minutes;
      any = true;
    }
  }
  return any ? total : null;
}

/**
 * Division FCFA exacte uniquement.
 * Ex. TOTAL 100_000 / 3 Jobbers → rejet (pas d'arrondi silencieux).
 */
export function divideFcfaExactly(
  total: number,
  workers: number,
  contextLabel = 'Le budget total',
): number {
  if (!Number.isInteger(total) || workers < 1) {
    throw new BadRequestException('Répartition tarifaire invalide.');
  }
  if (total % workers !== 0) {
    throw new BadRequestException(
      `${contextLabel} doit pouvoir être réparti équitablement entre les ${workers} Jobbers.`,
    );
  }
  return total / workers;
}

/** Commission et net futurs (lecture seule, non persistés sur Mission). */
export function computeCommissionSplit(workerGrossAmount: number): {
  commissionAmount: number;
  workerNetAmount: number;
} {
  if (!Number.isInteger(workerGrossAmount) || workerGrossAmount < 0) {
    throw new BadRequestException('Montant brut Jobber invalide.');
  }
  // Arrondi commission vers le bas pour privilégier le Jobber tant que Payment n'est pas défini.
  const commissionAmount = Math.floor(
    (workerGrossAmount * KINGJOBS_COMMISSION_BPS) / 10_000,
  );
  return {
    commissionAmount,
    workerNetAmount: workerGrossAmount - commissionAmount,
  };
}

function resolveUnits(input: PricingInput): number {
  if (input.pricingType === MissionPricingType.FIXED) {
    return 1;
  }

  if (input.pricingType === MissionPricingType.HOURLY) {
    const durationKnown = input.durationKnown !== false;
    if (!durationKnown) {
      throw new BadRequestException(
        'Durée estimée requise pour une tarification à l’heure.',
      );
    }

    // CAS 3 : additionner la durée de toutes les MissionOccurrence.
    const fromOccurrences = sumOccurrenceMinutes(input.occurrences);
    const minutes = fromOccurrences ?? input.estimatedDurationMinutes;
    if (
      !minutes ||
      !Number.isInteger(minutes) ||
      minutes < MISSION_LIMITS.MIN_DURATION_MINUTES
    ) {
      throw new BadRequestException(
        'Durée estimée requise pour une tarification à l’heure.',
      );
    }
    if (minutes % 60 !== 0) {
      // V1 : heures entières uniquement pour éviter fractions FCFA/heure.
      throw new BadRequestException(
        'La durée estimée doit être un multiple de 60 minutes (heures entières).',
      );
    }
    return minutes / 60;
  }

  // DAILY
  const fromOccurrences = input.occurrences?.length;
  const dayCount = input.dayCount ?? fromOccurrences ?? 1;
  if (!Number.isInteger(dayCount) || dayCount < 1) {
    throw new BadRequestException('Nombre de jours invalide pour DAILY.');
  }
  return dayCount;
}

/**
 * Calcule rémunération / Jobber et total Mission.
 * rateAmount = montant saisi (par personne OU budget global selon rateScope).
 */
export function computeMissionPricing(input: PricingInput): PricingComputed {
  const workers = input.workersNeeded;
  if (
    !Number.isInteger(workers) ||
    workers < MISSION_LIMITS.MIN_WORKERS_NEEDED ||
    workers > MISSION_LIMITS.MAX_WORKERS_NEEDED
  ) {
    throw new BadRequestException(
      `Nombre de Jobbers : entre ${MISSION_LIMITS.MIN_WORKERS_NEEDED} et ${MISSION_LIMITS.MAX_WORKERS_NEEDED}.`,
    );
  }

  const rateScope = input.rateScope;
  const rateAmount = input.rateAmount;
  assertPositiveAmount('Montant saisi', rateAmount);

  const units = resolveUnits(input);

  let ratePerJobberPerUnit: number;
  if (rateScope === MissionRateScope.PER_JOBBER) {
    ratePerJobberPerUnit = rateAmount;
  } else {
    ratePerJobberPerUnit = divideFcfaExactly(
      rateAmount,
      workers,
      'Le budget total',
    );
  }

  const workerGrossAmount = ratePerJobberPerUnit * units;
  if (!Number.isInteger(workerGrossAmount)) {
    throw new BadRequestException(
      'Le calcul tarifaire doit produire des montants FCFA entiers.',
    );
  }
  assertPositiveAmount('Montant brut par Jobber', workerGrossAmount);

  const estimatedTotalAmount = workerGrossAmount * workers;
  assertPositiveAmount('Estimation Mission', estimatedTotalAmount);

  return {
    pricingType: input.pricingType,
    rateAmount,
    rateScope,
    workersNeeded: workers,
    workerGrossAmount,
    estimatedTotalAmount,
    clientPriceAmount: estimatedTotalAmount,
    estimatedAmount: estimatedTotalAmount,
  };
}

/** Reconstruction lecture depuis une Mission persistée. */
export function derivePricingFromMission(mission: {
  pricingType: MissionPricingType;
  rateAmount: number | null;
  rateScope: MissionRateScope;
  clientPriceAmount: number;
  estimatedAmount: number | null;
  workersNeeded: number;
  estimatedDurationMinutes: number | null;
  durationKnown: boolean;
  schedulingType: MissionSchedulingType;
  occurrenceCount?: number;
}): PricingComputed {
  if (mission.rateAmount != null) {
    return computeMissionPricing({
      pricingType: mission.pricingType,
      rateAmount: mission.rateAmount,
      rateScope: mission.rateScope,
      workersNeeded: mission.workersNeeded,
      estimatedDurationMinutes: mission.estimatedDurationMinutes,
      durationKnown: mission.durationKnown,
      schedulingType: mission.schedulingType,
      dayCount: mission.occurrenceCount ?? 1,
    });
  }

  // Legacy : seul clientPriceAmount (souvent FIXED mono-jobber).
  const total = mission.estimatedAmount ?? mission.clientPriceAmount;
  if (mission.workersNeeded <= 1) {
    return {
      pricingType: mission.pricingType,
      rateAmount: total,
      rateScope: mission.rateScope,
      workersNeeded: mission.workersNeeded,
      workerGrossAmount: total,
      estimatedTotalAmount: total,
      clientPriceAmount: total,
      estimatedAmount: total,
    };
  }

  if (mission.rateScope === MissionRateScope.TOTAL) {
    return computeMissionPricing({
      pricingType: MissionPricingType.FIXED,
      rateAmount: total,
      rateScope: MissionRateScope.TOTAL,
      workersNeeded: mission.workersNeeded,
      durationKnown: true,
      dayCount: 1,
    });
  }

  const per = divideFcfaExactly(
    total,
    mission.workersNeeded,
    'Le montant Mission',
  );
  return {
    pricingType: mission.pricingType,
    rateAmount: per,
    rateScope: MissionRateScope.PER_JOBBER,
    workersNeeded: mission.workersNeeded,
    workerGrossAmount: per,
    estimatedTotalAmount: total,
    clientPriceAmount: total,
    estimatedAmount: total,
  };
}
