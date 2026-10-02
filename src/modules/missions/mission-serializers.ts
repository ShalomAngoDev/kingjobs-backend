import type {
  Mission,
  MissionApplication,
  MissionAssignment,
  MissionIncident,
  MissionStatusHistory,
} from '@prisma/client';
import {
  computeCommissionSplit,
  derivePricingFromMission,
} from './mission-pricing';
import { canSeeAddress } from './mission-rules';
import { computeStaffing } from './mission-staffing';

type DecimalLike = { toString(): string } | number | null | undefined;

function toNumber(value: DecimalLike): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value.toString());
}

function iso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function pricingView(m: Mission) {
  try {
    const computed = derivePricingFromMission({
      pricingType: m.pricingType,
      rateAmount: m.rateAmount,
      rateScope: m.rateScope,
      clientPriceAmount: m.clientPriceAmount,
      estimatedAmount: m.estimatedAmount,
      workersNeeded: m.workersNeeded,
      estimatedDurationMinutes: m.estimatedDurationMinutes,
      durationKnown: m.durationKnown,
      schedulingType: m.schedulingType,
    });
    return {
      workerGrossAmount: computed.workerGrossAmount,
      estimatedTotalAmount: computed.estimatedTotalAmount,
    };
  } catch {
    return {
      workerGrossAmount: m.clientPriceAmount,
      estimatedTotalAmount: m.estimatedAmount ?? m.clientPriceAmount,
    };
  }
}

/** Champs communs, sans aucune donnée de localisation précise. */
function baseMission(m: Mission) {
  const pricing = pricingView(m);
  return {
    id: m.id,
    reference: m.reference,
    status: m.status,
    title: m.title,
    description: m.description,
    service: {
      id: m.serviceId,
      name: m.serviceNameSnapshot,
      slug: m.serviceSlugSnapshot,
    },
    category: {
      name: m.categoryNameSnapshot,
      slug: m.categorySlugSnapshot,
    },
    countryCode: m.countryCode,
    city: m.city,
    district: m.district,
    locationNotes: m.locationNotes,
    schedulingType: m.schedulingType,
    scheduleStartDate: iso(m.scheduleStartDate),
    scheduleEndDate: iso(m.scheduleEndDate),
    scheduleSameHoursDaily: m.scheduleSameHoursDaily,
    selectedWeekdays: m.selectedWeekdays,
    durationKnown: m.durationKnown,
    scheduledStartAt: iso(m.scheduledStartAt),
    estimatedDurationMinutes: m.estimatedDurationMinutes,
    workersNeeded: m.workersNeeded,
    pricingType: m.pricingType,
    rateAmount: m.rateAmount,
    rateScope: m.rateScope,
    estimatedAmount: m.estimatedAmount,
    clientPriceAmount: m.clientPriceAmount,
    workerGrossAmount: pricing.workerGrossAmount,
    estimatedTotalAmount: pricing.estimatedTotalAmount,
    currency: m.currency,
    minimumAge: m.minimumAge,
    riskFlags: m.riskFlags,
    paymentConfirmedAt: iso(m.paymentConfirmedAt),
    submittedForReviewAt: iso(m.submittedForReviewAt),
    publishedAt: iso(m.publishedAt),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** Vue publique : jamais addressLine / latitude / longitude / clientUserId. */
export function serializeMissionPublic(m: Mission) {
  return { ...baseMission(m), addressVisible: false as const };
}

/** Identité publique Client exposée aux Jobbers : jamais email / téléphone / KYC. */
export type ClientPublicSummarySource = {
  firstName: string;
  lastName: string;
};

export function serializeClientPublicSummary(user: ClientPublicSummarySource) {
  const firstName = user.firstName.trim();
  const lastName = user.lastName.trim();
  return {
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(' ').trim(),
  };
}

/**
 * Vue Jobber (candidat / liste) : rémunération par personne mise en avant.
 * Le budget global Client n'est pas le signal principal.
 */
export function serializeMissionForJobber(
  m: Mission,
  client?: ClientPublicSummarySource | null,
) {
  const base = baseMission(m);
  const commission = computeCommissionSplit(base.workerGrossAmount);
  return {
    id: base.id,
    reference: base.reference,
    status: base.status,
    title: base.title,
    description: base.description,
    service: base.service,
    category: base.category,
    countryCode: base.countryCode,
    city: base.city,
    district: base.district,
    locationNotes: base.locationNotes,
    schedulingType: base.schedulingType,
    scheduleStartDate: base.scheduleStartDate,
    scheduleEndDate: base.scheduleEndDate,
    scheduleSameHoursDaily: base.scheduleSameHoursDaily,
    durationKnown: base.durationKnown,
    scheduledStartAt: base.scheduledStartAt,
    estimatedDurationMinutes: base.estimatedDurationMinutes,
    workersNeeded: base.workersNeeded,
    pricingType: base.pricingType,
    rateAmount: base.rateAmount,
    rateScope: base.rateScope,
    /** Rémunération brute pour CE Jobber (signal principal). */
    workerGrossAmount: base.workerGrossAmount,
    commissionRateBps: 1500,
    estimatedCommissionAmount: commission.commissionAmount,
    estimatedWorkerNetAmount: commission.workerNetAmount,
    currency: base.currency,
    minimumAge: base.minimumAge,
    riskFlags: base.riskFlags,
    publishedAt: base.publishedAt,
    addressVisible: false as const,
    client: client ? serializeClientPublicSummary(client) : null,
  };
}

/** Vue complète (Client propriétaire, Jobber affecté, ou Admin). */
export function serializeMissionWithAddress(m: Mission) {
  return {
    ...baseMission(m),
    addressVisible: true as const,
    addressLine: m.addressLine,
    latitude: toNumber(m.latitude),
    longitude: toNumber(m.longitude),
    clientUserId: m.clientUserId,
    selectedJobberUserId: m.selectedJobberUserId,
    assignedAt: iso(m.assignedAt),
    confirmedAt: iso(m.confirmedAt),
    startedAt: iso(m.startedAt),
    completionRequestedAt: iso(m.completionRequestedAt),
    completedAt: iso(m.completedAt),
    cancelledAt: iso(m.cancelledAt),
    /** Message visible Client uniquement (jamais internalNotes). */
    clientReviewMessage: m.clientReviewMessage,
    rejectionReasonCode: m.rejectionReasonCode,
    rejectionReasonText: m.rejectionReasonText,
  };
}

export function serializeMissionWithStaffing(
  m: Mission,
  activeAssignmentsCount: number,
) {
  return {
    ...serializeMissionWithAddress(m),
    ...computeStaffing(m.workersNeeded, activeAssignmentsCount),
  };
}

/** Sérialiseur actor-aware : choisit la vue selon l'utilisateur courant. */
export function serializeMissionForUser(
  m: Mission,
  userId: string,
  options?: { hasActiveAssignment?: boolean },
) {
  return canSeeAddress(m, userId, options)
    ? serializeMissionWithAddress(m)
    : serializeMissionPublic(m);
}

export function serializeAssignment(assignment: MissionAssignment) {
  const commission = computeCommissionSplit(assignment.workerGrossAmount);
  return {
    id: assignment.id,
    missionId: assignment.missionId,
    jobberUserId: assignment.jobberUserId,
    applicationId: assignment.applicationId,
    status: assignment.status,
    selectedAt: assignment.selectedAt.toISOString(),
    selectedByUserId: assignment.selectedByUserId,
    cancelledAt: iso(assignment.cancelledAt),
    cancellationReason: assignment.cancellationReason,
    workerGrossAmount: assignment.workerGrossAmount,
    commissionRateBps: assignment.commissionRateBps,
    estimatedCommissionAmount: commission.commissionAmount,
    estimatedWorkerNetAmount: commission.workerNetAmount,
    currency: assignment.currency,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
  };
}

export function serializeMissionAdmin(m: Mission) {
  return {
    ...serializeMissionWithAddress(m),
    reviewInternalNote: m.reviewInternalNote,
    clientReviewMessage: m.clientReviewMessage,
    reviewChangeAreas: m.reviewChangeAreas,
    rejectionReasonCode: m.rejectionReasonCode,
    rejectionReasonText: m.rejectionReasonText,
    financialFollowUpRequired: m.financialFollowUpRequired,
  };
}

export function serializePaymentAdmin(row: {
  id: string;
  amount: number;
  currency: string;
  provider: string;
  providerReference: string;
  status: string;
  confirmedAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}) {
  const isTestPayment = row.provider === 'MOCK';
  return {
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    provider: row.provider,
    providerReference: row.providerReference,
    status: row.status,
    isTestPayment,
    label: isTestPayment ? 'Paiement test' : 'Paiement',
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeMissionOccurrence(row: {
  id: string;
  occurrenceDate: Date;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  estimatedDurationMinutes: number | null;
  sortOrder: number;
}) {
  return {
    id: row.id,
    occurrenceDate: row.occurrenceDate.toISOString().slice(0, 10),
    plannedStartAt: iso(row.plannedStartAt),
    plannedEndAt: iso(row.plannedEndAt),
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    sortOrder: row.sortOrder,
  };
}

export function serializeMissionMedia(row: {
  id: string;
  mediaType: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    mediaType: row.mediaType,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

export type JobberSummarySource = {
  id: string;
  firstName: string;
  lastName: string;
  jobberProfile?: {
    headline: string | null;
    bio: string | null;
  } | null;
};

/** Résumé Jobber exposé au Client : jamais email, téléphone, date de naissance, hash. */
export function serializeJobberSummary(user: JobberSummarySource) {
  return {
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    headline: user.jobberProfile?.headline ?? null,
    bio: user.jobberProfile?.bio ?? null,
  };
}

export function serializeApplicationForClient(
  application: MissionApplication,
  jobber: JobberSummarySource,
) {
  return {
    id: application.id,
    missionId: application.missionId,
    status: application.status,
    message: application.message,
    appliedAt: application.appliedAt.toISOString(),
    selectedAt: iso(application.selectedAt),
    jobber: serializeJobberSummary(jobber),
  };
}

export function serializeApplicationForJobber(application: MissionApplication) {
  return {
    id: application.id,
    missionId: application.missionId,
    status: application.status,
    message: application.message,
    appliedAt: application.appliedAt.toISOString(),
    withdrawnAt: iso(application.withdrawnAt),
    selectedAt: iso(application.selectedAt),
    rejectedAt: iso(application.rejectedAt),
  };
}

export function serializeHistory(
  entry: MissionStatusHistory,
  options: { includeMetadata?: boolean } = {},
) {
  return {
    id: entry.id,
    missionId: entry.missionId,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    actorUserId: entry.actorUserId,
    reason: entry.reason,
    ...(options.includeMetadata ? { metadata: entry.metadata } : {}),
    createdAt: entry.createdAt.toISOString(),
  };
}

export function serializeIncident(incident: MissionIncident) {
  return {
    id: incident.id,
    missionId: incident.missionId,
    reportedByUserId: incident.reportedByUserId,
    type: incident.type,
    description: incident.description,
    status: incident.status,
    blocksMission: incident.blocksMission,
    createdAt: incident.createdAt.toISOString(),
    updatedAt: incident.updatedAt.toISOString(),
    resolvedAt: iso(incident.resolvedAt),
  };
}
