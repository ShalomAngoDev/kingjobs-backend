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
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

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
