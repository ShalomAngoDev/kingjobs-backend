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

export default (): { app: AppConfig; auth: AuthConfig } => {
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
  };
};
