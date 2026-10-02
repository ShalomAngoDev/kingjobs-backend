import type { CountryCode } from 'libphonenumber-js';

/**
 * Pays KingJOBS V1 (inscription / login téléphone).
 * Ajouter un pays = étendre cette liste uniquement.
 */
export const SUPPORTED_COUNTRY_CODES = ['BJ', 'CI', 'TG'] as const;

export type SupportedCountryCode = (typeof SUPPORTED_COUNTRY_CODES)[number];

export type SupportedCountry = {
  code: SupportedCountryCode;
  name: string;
  callingCode: `+${string}`;
  flagEmoji: string;
};

export const SUPPORTED_COUNTRIES: readonly SupportedCountry[] = [
  {
    code: 'BJ',
    name: 'Bénin',
    callingCode: '+229',
    flagEmoji: '🇧🇯',
  },
  {
    code: 'CI',
    name: "Côte d'Ivoire",
    callingCode: '+225',
    flagEmoji: '🇨🇮',
  },
  {
    code: 'TG',
    name: 'Togo',
    callingCode: '+228',
    flagEmoji: '🇹🇬',
  },
] as const;

export const DEFAULT_COUNTRY_CODE: SupportedCountryCode = 'BJ';

export function isSupportedCountryCode(
  value: unknown,
): value is SupportedCountryCode {
  return (
    typeof value === 'string' &&
    (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(value)
  );
}

export function getSupportedCountry(
  code: string | null | undefined,
): SupportedCountry {
  const found = SUPPORTED_COUNTRIES.find((c) => c.code === code);
  return found ?? SUPPORTED_COUNTRIES[0];
}

export function toLibPhoneCountry(
  code: SupportedCountryCode,
): CountryCode {
  return code;
}
