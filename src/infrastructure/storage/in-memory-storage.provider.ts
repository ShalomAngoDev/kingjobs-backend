import { Readable } from 'node:stream';
import {
  StorageObjectNotFoundError,
  assertSafeStorageKey,
  buildOpaqueStorageKey,
  type FileStorageService,
  type PutFileInput,
  type PutFileResult,
} from './file-storage.types';

/** Adapter mémoire pour tests unitaires (aucun bucket cloud). */
export class InMemoryStorageProvider implements FileStorageService {
  readonly files = new Map<string, Buffer>();

  put(input: PutFileInput): Promise<PutFileResult> {
    const key = buildOpaqueStorageKey({
      ownerId: input.ownerId,
      keyPrefix: input.keyPrefix,
    });
    this.files.set(key, input.buffer);
    return Promise.resolve({ key, sizeBytes: input.buffer.byteLength });
  }

  getStream(key: string): Promise<Readable> {
    assertSafeStorageKey(key);
    const file = this.files.get(key);
    if (!file) return Promise.reject(new StorageObjectNotFoundError(key));
    return Promise.resolve(Readable.from(file));
  }

  getSignedUrl(key: string, _ttlSeconds: number): Promise<string> {
    assertSafeStorageKey(key);
    if (!this.files.has(key)) {
      return Promise.reject(new StorageObjectNotFoundError(key));
    }
    return Promise.resolve(`memory://signed/${encodeURIComponent(key)}`);
  }

  delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    this.files.delete(key);
    return Promise.resolve();
  }
}
