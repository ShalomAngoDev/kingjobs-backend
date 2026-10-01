import type {
  Mission,
  MissionApplication,
  MissionIncident,
  MissionStatusHistory,
} from '@prisma/client';
import { canSeeAddress } from './mission-rules';

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

/** Champs communs, sans aucune donnée de localisation précise. */
function baseMission(m: Mission) {
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
    scheduledStartAt: iso(m.scheduledStartAt),
    estimatedDurationMinutes: m.estimatedDurationMinutes,
    clientPriceAmount: m.clientPriceAmount,
    currency: m.currency,
    minimumAge: m.minimumAge,
    riskFlags: m.riskFlags,
    publishedAt: iso(m.publishedAt),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** Vue publique : jamais addressLine / latitude / longitude / clientUserId. */
export function serializeMissionPublic(m: Mission) {
  return { ...baseMission(m), addressVisible: false as const };
}

/** Vue complète (Client propriétaire, Jobber sélectionné, ou Admin). */
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
  };
}

/** Sérialiseur actor-aware : choisit la vue selon l'utilisateur courant. */
export function serializeMissionForUser(m: Mission, userId: string) {
  return canSeeAddress(m, userId)
    ? serializeMissionWithAddress(m)
    : serializeMissionPublic(m);
}

export function serializeMissionAdmin(m: Mission) {
  return serializeMissionWithAddress(m);
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
