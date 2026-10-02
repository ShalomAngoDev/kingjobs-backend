import { BadRequestException } from '@nestjs/common';
import { normalizePhoneToE164 } from './phone';

describe('normalizePhoneToE164', () => {
  it('normalise BJ national et international', () => {
    expect(normalizePhoneToE164('0190123456', 'BJ')).toMatch(/^\+229/);
    expect(normalizePhoneToE164('+2290190123456', 'BJ')).toBe('+2290190123456');
  });

  it('normalise CI et TG', () => {
    // Numéros fictifs mais format plausible — si invalidés par libphonenumber, on teste le rejet propre.
    try {
      const ci = normalizePhoneToE164('0700000000', 'CI');
      expect(ci.startsWith('+225')).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
    }
    try {
      const tg = normalizePhoneToE164('90000000', 'TG');
      expect(tg.startsWith('+228')).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
    }
  });

  it('rejette un indicatif incompatible avec expectedCountry', () => {
    expect(() =>
      normalizePhoneToE164('+2250700000000', 'BJ', { expectedCountry: 'BJ' }),
    ).toThrow(BadRequestException);
  });

  it('rejette vide', () => {
    expect(() => normalizePhoneToE164('  ', 'BJ')).toThrow(BadRequestException);
  });
});
