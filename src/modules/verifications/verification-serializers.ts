import type {
  IdentityDocumentSubType,
  UserDocument,
  UserDocumentEvent,
  UserDocumentStatus,
  VerificationCase,
  VerificationCaseKind,
  VerificationCaseStatus,
} from '@prisma/client';

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

/** Réponse document côté UTILISATEUR : aucune clé de stockage, aucune note interne. */
export type UserDocumentResponse = {
  id: string;
  documentTypeCode: string;
  identitySubType: IdentityDocumentSubType | null;
  status: UserDocumentStatus;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string | null;
  capturedAt: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  reasonCode: string | null;
  userMessage: string | null;
  verificationCaseId: string | null;
};

export function serializeDocumentForUser(
  doc: UserDocument,
  documentTypeCode: string,
): UserDocumentResponse {
  return {
    id: doc.id,
    documentTypeCode,
    identitySubType: doc.identitySubType,
    status: doc.status,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    originalFilename: doc.originalFilename,
    capturedAt: iso(doc.capturedAt),
    submittedAt: doc.submittedAt.toISOString(),
    reviewedAt: iso(doc.reviewedAt),
    reasonCode: doc.reasonCode,
    userMessage: doc.userMessage,
    verificationCaseId: doc.verificationCaseId,
  };
}

export type DocumentRequirementMeta = {
  /** true = bloque APPROVE du dossier tant que non APPROVED. */
  mandatory: boolean;
  /** Libellé UI : Obligatoire | Facultatif */
  label: 'Obligatoire' | 'Facultatif';
  /** Ex. « Exigé pour Plomberie » via ServiceRequirement. */
  requiredForService: string | null;
};

export type AdminDocumentResponse = UserDocumentResponse & {
  userId: string;
  reviewedById: string | null;
  /** Chemin API du contenu (jamais le chemin de stockage). */
  contentPath: string;
  requirement?: DocumentRequirementMeta;
  events?: Array<{
    id: string;
    action: string;
    actorId: string | null;
    metadata: unknown;
    createdAt: string;
  }>;
};

export function serializeDocumentForAdmin(
  doc: UserDocument,
  documentTypeCode: string,
  events?: UserDocumentEvent[],
  requirement?: DocumentRequirementMeta,
): AdminDocumentResponse {
  return {
    ...serializeDocumentForUser(doc, documentTypeCode),
    userId: doc.userId,
    reviewedById: doc.reviewedById,
    contentPath: `/admin/documents/${doc.id}/content`,
    ...(requirement ? { requirement } : {}),
    ...(events
      ? {
          events: events.map((event) => ({
            id: event.id,
            action: event.action,
            actorId: event.actorId,
            metadata: event.metadata,
            createdAt: event.createdAt.toISOString(),
          })),
        }
      : {}),
  };
}

export type UserCaseResponse = {
  id: string;
  kind: VerificationCaseKind;
  status: VerificationCaseStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  /** Message destiné à l'utilisateur (demande de correction / refus). */
  userMessage: string | null;
  reasonCode: string | null;
};

export function serializeCaseForUser(c: VerificationCase): UserCaseResponse {
  return {
    id: c.id,
    kind: c.kind,
    status: c.status,
    submittedAt: iso(c.submittedAt),
    reviewedAt: iso(c.reviewedAt),
    userMessage: c.userMessage,
    reasonCode: c.reasonCode,
  };
}

export type AdminCaseResponse = UserCaseResponse & {
  userId: string;
  reviewedById: string | null;
  /** Visible par les admins uniquement. */
  internalNote: string | null;
  resubmitOfId: string | null;
  createdAt: string;
};

export function serializeCaseForAdmin(c: VerificationCase): AdminCaseResponse {
  return {
    ...serializeCaseForUser(c),
    userId: c.userId,
    reviewedById: c.reviewedById,
    internalNote: c.internalNote,
    resubmitOfId: c.resubmitOfId,
    createdAt: c.createdAt.toISOString(),
  };
}
