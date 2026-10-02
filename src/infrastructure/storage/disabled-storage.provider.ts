import type { Readable } from 'node:stream';
import {
  StorageConfigurationError,
  type FileStorageService,
  type PutFileInput,
  type PutFileResult,
} from './file-storage.types';

/**
 * Prod sans S3 exploitable : l'API démarre, uploads/lectures refusés.
 */
export class DisabledStorageProvider implements FileStorageService {
  constructor(
    private readonly reason = 'Stockage fichiers non configuré (object_storage / S3 requis).',
  ) {}

  put(_input: PutFileInput): Promise<PutFileResult> {
    return Promise.reject(new StorageConfigurationError(this.reason));
  }

  getStream(_key: string): Promise<Readable> {
    return Promise.reject(new StorageConfigurationError(this.reason));
  }

  getSignedUrl(_key: string, _ttlSeconds: number): Promise<string> {
    return Promise.reject(new StorageConfigurationError(this.reason));
  }

  delete(_key: string): Promise<void> {
    return Promise.reject(new StorageConfigurationError(this.reason));
  }
}
