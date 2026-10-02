import { BadRequestException } from '@nestjs/common';
import * as argon2 from 'argon2';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

export function validatePasswordPolicy(password: string): void {
  if (typeof password !== 'string') {
    throw new BadRequestException('Mot de passe invalide');
  }
  if (password.length < MIN_LENGTH) {
    throw new BadRequestException(
      `Le mot de passe doit contenir au moins ${MIN_LENGTH} caractères`,
    );
  }
  if (password.length > MAX_LENGTH) {
    throw new BadRequestException(
      `Le mot de passe ne peut pas dépasser ${MAX_LENGTH} caractères`,
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePasswordPolicy(password);
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
