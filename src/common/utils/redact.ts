import { SENSITIVE_LOG_KEYS } from '../constants';

const SENSITIVE_SET = new Set(
  SENSITIVE_LOG_KEYS.map((key) => key.toLowerCase()),
);

export function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_SET.has(key.toLowerCase())) {
    return '[REDACTED]';
  }
  return value;
}

export function redactObject(
  input: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = redactValue(key, value);
  }
  return output;
}
