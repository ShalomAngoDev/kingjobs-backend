export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  apiVersion: string;
  serviceName: string;
  appVersion: string;
  corsOrigins: string[];
  corsOriginRegexes: string[];
  bodyLimit: string;
  trustProxy: number;
  swaggerEnabled: boolean;
  throttleTtlMs: number;
  throttleLimit: number;
  gitSha: string | null;
  databaseUrl: string;
  directUrl: string;
};

export type StorageConfig = {
  provider: 'local_private' | 'object_storage' | 'memory';
  localPath: string;
  /** TTL URL signée (secondes), max 900. */
  signedUrlTtlSeconds: number;
  /** Taille max upload KYC (octets). */
  maxUploadBytes: number;
  s3: {
    endpoint: string | null;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
};

export type AuthConfig = {
  jwtAccessSecret: string;
  jwtAccessTtl: string;
  refreshTokenTtlDays: number;
  emailVerifyTtlHours: number;
  passwordResetTtlMinutes: number;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  resendApiKey: string | null;
  emailFrom: string;
  appWebUrl: string;
  smsProvider: 'console' | 'none';
  defaultPhoneRegion: string;
};

/** Paiement publication Mission. Fail-closed : mock uniquement si explicite. */
export type PaymentConfig = {
  /** `mock` = simulateur DEV ; `none` = pas de provider (défaut). */
  provider: 'mock' | 'none';
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseList(raw: string | undefined, fallback = ''): string[] {
  return (raw ?? fallback)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseOrigins(raw: string): string[] {
  return parseList(raw);
}

/** Première valeur d'env non vide (alias S3 / AWS). */
function firstEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function resolveSmsProvider(
  nodeEnv: AppConfig['nodeEnv'],
  raw: string | undefined,
): AuthConfig['smsProvider'] {
  if (raw === 'console' || raw === 'none') {
    return raw;
  }
  if (nodeEnv === 'production') {
    return 'none';
  }
  return 'console';
}

export default (): {
  app: AppConfig;
  auth: AuthConfig;
  storage: StorageConfig;
  payment: PaymentConfig;
} => {
  const nodeEnv = (process.env.NODE_ENV ??
    'development') as AppConfig['nodeEnv'];
  const swaggerDefault = nodeEnv !== 'production';
  const storageProviderRaw = (
    process.env.STORAGE_PROVIDER ?? 'local_private'
  ).trim();
  const storageProvider =
    storageProviderRaw === 'object_storage' ||
    storageProviderRaw === 'memory' ||
    storageProviderRaw === 'local_private'
      ? storageProviderRaw
      : 'local_private';

  const paymentProviderRaw = (process.env.PAYMENT_PROVIDER ?? 'none')
    .trim()
    .toLowerCase();
  const paymentProvider: PaymentConfig['provider'] =
    paymentProviderRaw === 'mock' ? 'mock' : 'none';

  return {
    app: {
      nodeEnv,
      port: Number(process.env.PORT ?? 3001),
      apiPrefix: process.env.API_PREFIX ?? 'api',
      apiVersion: process.env.API_VERSION ?? '1',
      serviceName: process.env.SERVICE_NAME ?? 'kingjobs-api',
      appVersion: process.env.APP_VERSION ?? '0.1.0',
      corsOrigins: parseOrigins(
        process.env.CORS_ORIGINS ??
          'http://localhost:3000,https://kingjobs.co,https://www.kingjobs.co',
      ),
      corsOriginRegexes: parseList(
        process.env.CORS_ORIGIN_REGEXES,
        '^https://.*\\.vercel\\.app$',
      ),
      bodyLimit: process.env.BODY_LIMIT ?? '1mb',
      trustProxy: Number(process.env.TRUST_PROXY ?? 1),
      swaggerEnabled: parseBoolean(process.env.SWAGGER_ENABLED, swaggerDefault),
      throttleTtlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
      throttleLimit: Number(process.env.THROTTLE_LIMIT ?? 100),
      gitSha: process.env.GIT_SHA?.trim() || null,
      databaseUrl: process.env.DATABASE_URL ?? '',
      directUrl: process.env.DIRECT_URL ?? '',
    },
    storage: {
      provider: storageProvider,
      localPath:
        process.env.FILE_STORAGE_PATH?.trim() || './.data/private-uploads',
      signedUrlTtlSeconds: Number(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? 180),
      maxUploadBytes: Number(
        process.env.STORAGE_MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024,
      ),
      s3: {
        endpoint:
          firstEnv('S3_ENDPOINT', 'AWS_ENDPOINT_URL', 'AWS_S3_ENDPOINT') ||
          null,
        region:
          firstEnv('S3_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION') || 'auto',
        bucket: firstEnv('S3_BUCKET', 'AWS_S3_BUCKET', 'AWS_BUCKET'),
        accessKeyId: firstEnv('S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
        secretAccessKey: firstEnv(
          'S3_SECRET_ACCESS_KEY',
          'AWS_SECRET_ACCESS_KEY',
        ),
        forcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, true),
      },
    },
    auth: {
      jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
      jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
      refreshTokenTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
      emailVerifyTtlHours: Number(process.env.EMAIL_VERIFY_TTL_HOURS ?? 24),
      passwordResetTtlMinutes: Number(
        process.env.PASSWORD_RESET_TTL_MINUTES ?? 30,
      ),
      otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 5),
      otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS ?? 5),
      resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
      emailFrom: process.env.EMAIL_FROM ?? 'KingJOBS <noreply@kingjobs.co>',
      appWebUrl: process.env.APP_WEB_URL ?? 'http://localhost:3000',
      smsProvider: resolveSmsProvider(nodeEnv, process.env.SMS_PROVIDER),
      defaultPhoneRegion: process.env.DEFAULT_PHONE_REGION ?? 'BJ',
    },
    payment: {
      provider: paymentProvider,
    },
  };
};
