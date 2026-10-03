import {
  hashPassword,
  validatePasswordPolicy,
  verifyPassword,
} from './password';

describe('password utils', () => {
  it('rejette un mot de passe trop court', () => {
    expect(() => validatePasswordPolicy('short')).toThrow();
    expect(() => validatePasswordPolicy('1234567')).toThrow();
  });

  it('accepte 8 caractères', () => {
    expect(() => validatePasswordPolicy('12345678')).not.toThrow();
  });

  it('accepte et vérifie un hash argon2id', async () => {
    const password = 'motdepasse-valide';
    const hash = await hashPassword(password);
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, password)).toBe(true);
    expect(await verifyPassword(hash, 'autre-mot-de-passe')).toBe(false);
  });
});
