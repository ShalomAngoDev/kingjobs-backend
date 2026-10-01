export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiPrefix: string;
  apiVersion: string;
  serviceName: string;
  appVersion: string;
  corsOrigins: string[];
  bodyLimit: string;
  trustProxy: number;
  swaggerEnabled: boolean;
  throttleTtlMs: number;
  throttleLimit: number;
  gitSha: string | null;
  databaseUrl: string;
  directUrl: string;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export default (): { app: AppConfig } => {
  const nodeEnv = (process.env.NODE_ENV ??
    'development') as AppConfig['nodeEnv'];
  const swaggerDefault = nodeEnv !== 'production';

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
      bodyLimit: process.env.BODY_LIMIT ?? '1mb',
      trustProxy: Number(process.env.TRUST_PROXY ?? 1),
      swaggerEnabled: parseBoolean(process.env.SWAGGER_ENABLED, swaggerDefault),
      throttleTtlMs: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
      throttleLimit: Number(process.env.THROTTLE_LIMIT ?? 100),
      gitSha: process.env.GIT_SHA?.trim() || null,
      databaseUrl: process.env.DATABASE_URL ?? '',
      directUrl: process.env.DIRECT_URL ?? '',
    },
  };
};
