import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig, StorageConfig } from '../../config/configuration';
import {
  FILE_STORAGE,
  StorageConfigurationError,
  type FileStorageService,
} from './file-storage.types';
import { InMemoryStorageProvider } from './in-memory-storage.provider';
import { LocalPrivateStorageProvider } from './local-private-storage.provider';
import { ObjectStorageProvider } from './object-storage.provider';

function createFileStorage(
  app: AppConfig,
  storage: StorageConfig,
): FileStorageService {
  if (storage.provider === 'memory') {
    return new InMemoryStorageProvider();
  }

  if (storage.provider === 'local_private') {
    if (app.nodeEnv === 'production') {
      throw new StorageConfigurationError(
        'STORAGE_PROVIDER=local_private est interdit en production. Configurez object_storage (S3-compatible) pour les pièces KYC.',
      );
    }
    return new LocalPrivateStorageProvider(storage.localPath);
  }

  if (storage.provider === 'object_storage') {
    if (
      !storage.s3.bucket ||
      !storage.s3.accessKeyId ||
      !storage.s3.secretAccessKey ||
      !storage.s3.region
    ) {
      throw new StorageConfigurationError(
        'object_storage exige S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID et S3_SECRET_ACCESS_KEY.',
      );
    }
    return new ObjectStorageProvider({
      endpoint: storage.s3.endpoint ?? undefined,
      region: storage.s3.region,
      bucket: storage.s3.bucket,
      accessKeyId: storage.s3.accessKeyId,
      secretAccessKey: storage.s3.secretAccessKey,
      forcePathStyle: storage.s3.forcePathStyle,
    });
  }

  throw new StorageConfigurationError(
    `STORAGE_PROVIDER inconnu : ${String(storage.provider)}`,
  );
}

@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const app = configService.getOrThrow<AppConfig>('app');
        const storage = configService.getOrThrow<StorageConfig>('storage');
        return createFileStorage(app, storage);
      },
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
