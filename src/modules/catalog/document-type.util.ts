import { UserDocumentStatus } from '@prisma/client';

/** Codes d'identité KingJOBS : hors configuration professionnelle par Service. */
export const IDENTITY_DOCUMENT_TYPE_CODES: readonly string[] = [
  'IDENTITY_DOCUMENT',
  'CIP',
  'PASSPORT',
  'RESIDENCE_CERTIFICATE',
  'LIVE_SELFIE',
] as const;

/** Génère un code DocumentType stable à partir d'un libellé Admin. */
export function documentTypeCodeFromName(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return ascii || 'DOCUMENT';
}

/** Normalisation pour dédoublonnage de noms. */
export function normalizeDocumentTypeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isIdentityDocumentTypeCode(code: string): boolean {
  return IDENTITY_DOCUMENT_TYPE_CODES.includes(code);
}

export const APPROVED_FOR_ELIGIBILITY: readonly UserDocumentStatus[] = [
  UserDocumentStatus.APPROVED,
];
