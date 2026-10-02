import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import {
  StorageObjectNotFoundError,
  assertSafeStorageKey,
  buildOpaqueStorageKey,
  type FileStorageService,
  type PutFileInput,
  type PutFileResult,
} from './file-storage.types';

export const DEFAULT_FILE_STORAGE_PATH = './.data/private-uploads';

/**
 * Stockage disque local, hors de tout dossier public.
 * Développement / Docker uniquement. Interdit en production (fail-fast module).
 */
export class LocalPrivateStorageProvider implements FileStorageService {
  private readonly root: string;

  constructor(basePath?: string) {
    this.root = resolve(
      basePath || process.env.FILE_STORAGE_PATH || DEFAULT_FILE_STORAGE_PATH,
    );
  }

  async put(input: PutFileInput): Promise<PutFileResult> {
    const key = buildOpaqueStorageKey({
      ownerId: input.ownerId,
      keyPrefix: input.keyPrefix,
    });
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, input.buffer, { mode: 0o600, flag: 'wx' });
    return { key, sizeBytes: input.buffer.byteLength };
  }

  async getStream(key: string): Promise<Readable> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch {
      throw new StorageObjectNotFoundError(key);
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    assertSafeStorageKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep) && path !== this.root) {
      throw new StorageObjectNotFoundError(key);
    }
    return path;
  }
}
