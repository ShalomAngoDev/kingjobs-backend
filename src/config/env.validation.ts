import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV!: 'development' | 'test' | 'production';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  DIRECT_URL!: string;

  @IsString()
  @IsNotEmpty()
  API_PREFIX!: string;

  @IsString()
  @IsNotEmpty()
  API_VERSION!: string;

  @IsString()
  @IsNotEmpty()
  SERVICE_NAME!: string;

  @IsOptional()
  @IsString()
  APP_VERSION?: string;

  @IsString()
  @IsNotEmpty()
  CORS_ORIGINS!: string;

  @IsOptional()
  @IsString()
  CORS_ORIGIN_REGEXES?: string;

  @IsOptional()
  @IsString()
  BODY_LIMIT?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  TRUST_PROXY?: number;

  @IsOptional()
  @IsBooleanString()
  SWAGGER_ENABLED?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  THROTTLE_TTL_MS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT?: number;

  @IsOptional()
  @IsString()
  GIT_SHA?: string;

  @IsString()
  @MinLength(32)
  JWT_ACCESS_SECRET!: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  EMAIL_VERIFY_TTL_HOURS?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  PASSWORD_RESET_TTL_MINUTES?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OTP_TTL_MINUTES?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  OTP_MAX_ATTEMPTS?: number;

  @IsOptional()
  @IsString()
  RESEND_API_KEY?: string;

  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  @IsOptional()
  @IsString()
  APP_WEB_URL?: string;

  @IsOptional()
  @IsIn(['console', 'none'])
  SMS_PROVIDER?: 'console' | 'none';

  @IsOptional()
  @IsString()
  DEFAULT_PHONE_REGION?: string;

  @IsOptional()
  @IsString()
  FILE_STORAGE_PATH?: string;

  @IsOptional()
  @IsIn(['local_private', 'object_storage', 'memory'])
  STORAGE_PROVIDER?: 'local_private' | 'object_storage' | 'memory';

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  S3_REGION?: string;

  @IsOptional()
  @IsString()
  S3_BUCKET?: string;

  @IsOptional()
  @IsString()
  S3_ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  S3_SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsBooleanString()
  S3_FORCE_PATH_STYLE?: string;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(900)
  STORAGE_SIGNED_URL_TTL_SECONDS?: number;

  @IsOptional()
  @IsInt()
  @Min(1024)
  @Max(20 * 1024 * 1024)
  STORAGE_MAX_UPLOAD_BYTES?: number;

  /**
   * mock = simulateur DEV (interdit en prod via factory).
   * none / absent = fail-closed (endpoints simulation refusés).
   */
  @IsOptional()
  @IsIn(['mock', 'none'])
  PAYMENT_PROVIDER?: 'mock' | 'none';
}

/** Défauts non-secrets (Render manuel sans Blueprint / vars oubliées). */
function withEnvDefaults(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...config,
    NODE_ENV: config.NODE_ENV ?? 'production',
    PORT: config.PORT ?? 3001,
    API_PREFIX: config.API_PREFIX ?? 'api',
    API_VERSION: config.API_VERSION ?? '1',
    SERVICE_NAME: config.SERVICE_NAME ?? 'kingjobs-api',
    APP_VERSION: config.APP_VERSION ?? '0.1.0',
    CORS_ORIGINS:
      config.CORS_ORIGINS ?? 'https://kingjobs.co,https://www.kingjobs.co',
    CORS_ORIGIN_REGEXES:
      config.CORS_ORIGIN_REGEXES ?? '^https://.*\\.vercel\\.app$',
    TRUST_PROXY: config.TRUST_PROXY ?? 1,
    SMS_PROVIDER: config.SMS_PROVIDER ?? 'none',
    EMAIL_FROM: config.EMAIL_FROM ?? 'KingJOBS <noreply@kingjobs.co>',
    APP_WEB_URL: config.APP_WEB_URL ?? 'https://kingjobs.co',
  };
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(
    EnvironmentVariables,
    withEnvDefaults(config),
    {
      enableImplicitConversion: true,
    },
  );

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
    forbidNonWhitelisted: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .filter(Boolean)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return validated;
}
