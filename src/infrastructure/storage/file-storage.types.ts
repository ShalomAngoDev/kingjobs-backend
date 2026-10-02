import { createHash, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

export const FILE_STORAGE = Symbol('FILE_STORAGE');

export type StorageProviderName = 'local_private' | 'object_storage' | 'memory';

export type PutFileInput = {
  buffer: Buffer;
  mimeType: string;
  /**
   * Identifiant opaque du propriétaire (ex. userId) pour préfixer la clé.
   * Jamais d'email / nom / téléphone.
   */
  ownerId?: string;
  /** Préfixe logique (défaut : verification). */
  keyPrefix?: string;
};

export type PutFileResult = {
  /** Clé opaque (jamais un chemin public, jamais exposée aux clients). */
  key: string;
  sizeBytes: number;
};

/**
 * Stockage de fichiers PRIVÉS (pièces d'identité, selfies...).
 * Les clés sont générées par le provider : opaques et non devinables.
 */
export interface FileStorageService {
  put(input: PutFileInput): Promise<PutFileResult>;
  getStream(key: string): Promise<Readable>;
  /** Providers objet (S3…) : URL signée courte durée. Jamais persistée. */
  getSignedUrl?(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Objet de stockage introuvable (${key.slice(0, 8)}...)`);
    this.name = 'StorageObjectNotFoundError';
  }
}

export class StorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

/** Clé opaque : `verification/{hash16}/{uuid}` (sans PII). */
export function buildOpaqueStorageKey(input: {
  ownerId?: string;
  keyPrefix?: string;
}): string {
  const prefix = (input.keyPrefix ?? 'verification').replace(/[^a-z0-9_-]/gi, '');
  const ownerHash = input.ownerId
    ? createHash('sha256').update(input.ownerId).digest('hex').slice(0, 16)
    : 'anonymous';
  return `${prefix}/${ownerHash}/${randomUUID()}`;
}

/** Valide une clé opaque générée par KingJOBS (anti path traversal). */
export function isOpaqueStorageKey(key: string): boolean {
  return /^[a-z0-9_-]{1,32}\/[0-9a-f]{16}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    key,
  );
}

/** Ancien format local `ab/<uuid>` (compat lecture). */
export function isLegacyLocalStorageKey(key: string): boolean {
  return /^[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    key,
  );
}

export function assertSafeStorageKey(key: string): void {
  if (!isOpaqueStorageKey(key) && !isLegacyLocalStorageKey(key)) {
    throw new StorageObjectNotFoundError(key);
  }
  if (key.includes('..') || key.includes('\\') || key.startsWith('/')) {
    throw new StorageObjectNotFoundError(key);
  }
}

/** Filename UX uniquement : jamais utilisé comme storage key. */
export function sanitizeOriginalFilename(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const base = raw
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\w.\- ()\[\]]+/g, '_')
    .trim();
  if (!base || base === '.' || base === '..') return null;
  return base.slice(0, 180);
}
