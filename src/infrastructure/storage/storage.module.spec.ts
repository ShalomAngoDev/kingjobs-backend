import { createFileStorage } from './storage.module';
import { DisabledStorageProvider } from './disabled-storage.provider';
import { LocalPrivateStorageProvider } from './local-private-storage.provider';
import { ObjectStorageProvider } from './object-storage.provider';
import type { AppConfig, StorageConfig } from '../../config/configuration';

function baseApp(nodeEnv: AppConfig['nodeEnv']): AppConfig {
  return {
    nodeEnv,
    port: 3001,
    apiPrefix: 'api',
    apiVersion: '1',
    serviceName: 'test',
    appVersion: '0',
    corsOrigins: [],
    corsOriginRegexes: [],
    bodyLimit: '1mb',
    trustProxy: 1,
    swaggerEnabled: false,
    throttleTtlMs: 60_000,
    throttleLimit: 100,
    gitSha: null,
    databaseUrl: '',
    directUrl: '',
  };
}

function baseStorage(
  overrides: Partial<StorageConfig> & {
    s3?: Partial<StorageConfig['s3']>;
  } = {},
): StorageConfig {
  return {
    provider: overrides.provider ?? 'local_private',
    localPath: overrides.localPath ?? './.data/private-uploads',
    signedUrlTtlSeconds: overrides.signedUrlTtlSeconds ?? 180,
    maxUploadBytes: overrides.maxUploadBytes ?? 8 * 1024 * 1024,
    s3: {
      endpoint: null,
      region: 'auto',
      bucket: '',
      accessKeyId: '',
      secretAccessKey: '',
      forcePathStyle: true,
      ...overrides.s3,
    },
  };
}

describe('createFileStorage', () => {
  it('refuse local_private en prod via provider désactivé (boot OK)', () => {
    const storage = createFileStorage(
      baseApp('production'),
      baseStorage({ provider: 'local_private' }),
    );
    expect(storage).toBeInstanceOf(DisabledStorageProvider);
  });

  it('object_storage incomplet en prod → désactivé (pas de crash boot)', () => {
    const storage = createFileStorage(
      baseApp('production'),
      baseStorage({ provider: 'object_storage' }),
    );
    expect(storage).toBeInstanceOf(DisabledStorageProvider);
  });

  it('object_storage complet → ObjectStorageProvider', () => {
    const storage = createFileStorage(
      baseApp('production'),
      baseStorage({
        provider: 'object_storage',
        s3: {
          endpoint: 'https://example.r2.cloudflarestorage.com',
          region: 'auto',
          bucket: 'kingjobs',
          accessKeyId: 'key',
          secretAccessKey: 'secret',
          forcePathStyle: true,
        },
      }),
    );
    expect(storage).toBeInstanceOf(ObjectStorageProvider);
  });

  it('local_private en development → LocalPrivateStorageProvider', () => {
    const storage = createFileStorage(
      baseApp('development'),
      baseStorage({ provider: 'local_private' }),
    );
    expect(storage).toBeInstanceOf(LocalPrivateStorageProvider);
  });
});
