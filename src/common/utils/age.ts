import { BadRequestException } from '@nestjs/common';

/** Âge entier en années révolues à la date `now` (défaut: aujourd'hui). */
export function calculateAge(
  dateOfBirth: Date,
  now: Date = new Date(),
): number {
  const dob = new Date(
    dateOfBirth.getFullYear(),
    dateOfBirth.getMonth(),
    dateOfBirth.getDate(),
  );
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

/** Mineur = âge strictement inférieur à 18 ans. */
export function isMinor(dateOfBirth: Date, now: Date = new Date()): boolean {
  return calculateAge(dateOfBirth, now) < 18;
}

/**
 * Vérifie l'âge minimum (16 ans). Lève BadRequestException si trop jeune.
 * @returns l'âge calculé
 */
export function assertMinimumAge(
  dateOfBirth: Date,
  minimumAge = 16,
  now: Date = new Date(),
): number {
  const age = calculateAge(dateOfBirth, now);
  if (age < minimumAge) {
    throw new BadRequestException(
      `Vous devez avoir au moins ${minimumAge} ans pour créer un compte`,
    );
  }
  return age;
}
