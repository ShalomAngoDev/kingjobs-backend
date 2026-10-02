import { UserDocumentStatus, type PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'documentType' | 'userDocument'>;

/** Chemin API admin du contenu (jamais une clé de stockage). */
export function adminDocumentContentPath(documentId: string): string {
  return `/admin/documents/${documentId}/content`;
}

/**
 * Dernière photo de profil APPROUVÉE par utilisateur.
 * Distincte du selfie KYC (`LIVE_SELFIE`).
 */
export async function loadApprovedProfilePhotoIds(
  db: Db,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;

  const type = await db.documentType.findUnique({
    where: { code: 'PROFILE_PHOTO' },
    select: { id: true },
  });
  if (!type) return result;

  const docs = await db.userDocument.findMany({
    where: {
      userId: { in: unique },
      documentTypeId: type.id,
      status: UserDocumentStatus.APPROVED,
    },
    orderBy: [{ reviewedAt: 'desc' }, { submittedAt: 'desc' }],
    select: { id: true, userId: true },
  });

  for (const doc of docs) {
    if (!result.has(doc.userId)) {
      result.set(doc.userId, doc.id);
    }
  }
  return result;
}

export function avatarUrlFromProfilePhotoId(
  documentId: string | null | undefined,
): string | null {
  return documentId ? adminDocumentContentPath(documentId) : null;
}
