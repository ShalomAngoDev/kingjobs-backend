import { calculateAge, isMinor, assertMinimumAge } from './age';

function localDate(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d);
}

describe('calculateAge', () => {
  const today = localDate(2026, 10, 1);

  it('refuses under 16 (15 years + 364 days)', () => {
    const dob = localDate(2010, 10, 2);
    expect(calculateAge(dob, today)).toBe(15);
    expect(() => assertMinimumAge(dob, 16, today)).toThrow();
  });

  it('accepts exactly 16 years today', () => {
    const dob = localDate(2010, 10, 1);
    expect(calculateAge(dob, today)).toBe(16);
    expect(assertMinimumAge(dob, 16, today)).toBe(16);
    expect(isMinor(dob, today)).toBe(true);
  });

  it('marks 17 as minor', () => {
    const dob = localDate(2009, 5, 1);
    expect(calculateAge(dob, today)).toBe(17);
    expect(isMinor(dob, today)).toBe(true);
  });

  it('marks 18 as adult', () => {
    const dob = localDate(2008, 10, 1);
    expect(calculateAge(dob, today)).toBe(18);
    expect(isMinor(dob, today)).toBe(false);
  });
});
