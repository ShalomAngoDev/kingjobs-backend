export const REQUEST_ID_HEADER = 'x-request-id';

export const SENSITIVE_LOG_KEYS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'database_url',
  'direct_url',
  'secret',
  'api_key',
  'access_token',
  'refresh_token',
  'card',
  'identity',
  'document',
] as const;

export * from './catalog-limits';
