/** Normalisation email : trim + lowercase uniquement (pas de plus-addressing). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
