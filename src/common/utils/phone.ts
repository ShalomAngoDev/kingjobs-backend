import { BadRequestException } from '@nestjs/common';
import {
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Parse un numéro (national ou international) et le stocke en E.164.
 * `defaultCountry` (défaut BJ) sert uniquement au parsing des formats locaux.
 */
export function normalizePhoneToE164(
  input: string,
  defaultCountry: CountryCode = 'BJ',
): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new BadRequestException('Numéro de téléphone invalide');
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    throw new BadRequestException('Numéro de téléphone invalide');
  }

  return parsed.format('E.164');
}
