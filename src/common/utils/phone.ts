import { BadRequestException } from '@nestjs/common';
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import {
  isSupportedCountryCode,
  type SupportedCountryCode,
} from '../constants/supported-countries';

export type NormalizePhoneOptions = {
  /** Si fourni, le numéro parsé doit appartenir à ce pays. */
  expectedCountry?: SupportedCountryCode | CountryCode;
};

/**
 * Parse un numéro (national ou international) et le stocke en E.164.
 * `defaultCountry` sert au parsing des formats locaux (sans +indicatif).
 */
export function normalizePhoneToE164(
  input: string,
  defaultCountry: CountryCode = 'BJ',
  options?: NormalizePhoneOptions,
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException('Numéro de téléphone invalide');
  }

  const region = (
    isSupportedCountryCode(defaultCountry) ? defaultCountry : 'BJ'
  ) as CountryCode;

  const parsed = parsePhoneNumberFromString(trimmed, region);
  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException('Numéro de téléphone invalide');
  }

  if (options?.expectedCountry) {
    const expected = options.expectedCountry;
    if (parsed.country && parsed.country !== expected) {
      throw new BadRequestException(
        'Le numéro de téléphone ne correspond pas au pays sélectionné.',
      );
    }
  }

  return parsed.format('E.164');
}
