import {
  generateOpaqueToken,
  generateOtpCode,
  sha256Hex,
} from './crypto-tokens';

describe('crypto-tokens', () => {
  it('sha256Hex produit un hex de 64 caractères déterministe', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(sha256Hex('hello')).toHaveLength(64);
  });

  it('generateOpaqueToken produit des jetons distincts', () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it('generateOtpCode renvoie 6 chiffres', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });
});
