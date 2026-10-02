import { Injectable } from '@nestjs/common';
import { UserDocumentStatus } from '@prisma/client';

export const DOCUMENT_CODES = {
  IDENTITY_DOCUMENT: 'IDENTITY_DOCUMENT',
  CIP: 'CIP',
  PASSPORT: 'PASSPORT',
  RESIDENCE_CERTIFICATE: 'RESIDENCE_CERTIFICATE',
  LIVE_SELFIE: 'LIVE_SELFIE',
} as const;

/** Types dont l'un suffit à couvrir la « pièce d'identité ». */
export const IDENTITY_PROOF_CODES: readonly string[] = [
  DOCUMENT_CODES.CIP,
  DOCUMENT_CODES.PASSPORT,
  DOCUMENT_CODES.IDENTITY_DOCUMENT,
];

/** Tous les types de documents rattachés au dossier IDENTITY. */
export const IDENTITY_CASE_DOCUMENT_CODES: readonly string[] = [
  ...IDENTITY_PROOF_CODES,
  DOCUMENT_CODES.RESIDENCE_CERTIFICATE,
  DOCUMENT_CODES.LIVE_SELFIE,
];

/** Statuts de document qui comptent comme « présent et exploitable » (soumission). */
export const USABLE_DOCUMENT_STATUSES: readonly UserDocumentStatus[] = [
  UserDocumentStatus.PENDING,
  UserDocumentStatus.UNDER_REVIEW,
  UserDocumentStatus.APPROVED,
];

/** Seul statut accepté pour valider un dossier (pièces obligatoires). */
export const APPROVED_DOCUMENT_STATUSES: readonly UserDocumentStatus[] = [
  UserDocumentStatus.APPROVED,
];

export type IdentityCompletionResult = {
  complete: boolean;
  missing: string[];
};

export type DocumentPresence = {
  /** Code du DocumentType (CIP, PASSPORT...). */
  documentTypeCode: string;
  status: UserDocumentStatus;
};

/**
 * Vérifie les pièces exigées pour soumettre l'identité :
 * - CIP, PASSPORT ou IDENTITY_DOCUMENT
 * - RESIDENCE_CERTIFICATE
 * - LIVE_SELFIE
 * Un document REJECTED / NEEDS_CHANGES / EXPIRED ne compte pas.
 *
 * Pour APPROVE du dossier IDENTITY : utiliser `checkApproved`
 * (chaque pièce obligatoire doit être APPROVED, pas seulement présente).
 */
@Injectable()
export class IdentityCompletionService {
  check(documents: readonly DocumentPresence[]): IdentityCompletionResult {
    return this.checkWithStatuses(documents, USABLE_DOCUMENT_STATUSES);
  }

  /** Précondition objective pour APPROVE d'un dossier IDENTITY. */
  checkApproved(
    documents: readonly DocumentPresence[],
  ): IdentityCompletionResult {
    return this.checkWithStatuses(documents, APPROVED_DOCUMENT_STATUSES);
  }

  private checkWithStatuses(
    documents: readonly DocumentPresence[],
    allowed: readonly UserDocumentStatus[],
  ): IdentityCompletionResult {
    const usable = new Set(
      documents
        .filter((d) => allowed.includes(d.status))
        .map((d) => d.documentTypeCode),
    );

    const missing: string[] = [];
    if (!IDENTITY_PROOF_CODES.some((code) => usable.has(code))) {
      missing.push('CIP_OU_PASSPORT');
    }
    if (!usable.has(DOCUMENT_CODES.RESIDENCE_CERTIFICATE)) {
      missing.push(DOCUMENT_CODES.RESIDENCE_CERTIFICATE);
    }
    if (!usable.has(DOCUMENT_CODES.LIVE_SELFIE)) {
      missing.push(DOCUMENT_CODES.LIVE_SELFIE);
    }
    return { complete: missing.length === 0, missing };
  }
}
