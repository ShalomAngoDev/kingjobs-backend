/**
 * Limites & conventions métier Backend 04 — Missions.
 * Montants : clientPriceAmount = entier FCFA (XOF), sans subdivision.
 */
export const MISSION_LIMITS = {
  TITLE_MIN: 5,
  TITLE_MAX: 80,
  DESCRIPTION_MAX: 4000,
  ADDRESS_MAX: 255,
  APPLICATION_MESSAGE_MAX: 1000,
  INCIDENT_DESCRIPTION_MAX: 2000,
  CANCELLATION_REASON_MAX: 1000,
  MIN_PRICE_XOF: 500,
  MAX_PRICE_XOF: 5_000_000,
  MIN_DURATION_MINUTES: 30,
  MAX_DURATION_MINUTES: 24 * 60,
  MIN_WORKERS_NEEDED: 1,
  /** V1 : besoin exprimé uniquement (multi-assignment non opérationnel). */
  MAX_WORKERS_NEEDED: 50,
  MAX_SCHEDULE_SPAN_DAYS: 30,
  MAX_SCHEDULE_OCCURRENCES: 31,
  MAX_MISSION_MEDIA: 5,
  MAX_MISSION_MEDIA_BYTES: 5 * 1024 * 1024,
  LOCATION_NOTES_MAX: 500,
  REVIEW_MESSAGE_MAX: 2000,
  REVIEW_INTERNAL_NOTE_MAX: 2000,
  DEFAULT_CURRENCY: 'XOF',
  DEFAULT_COUNTRY: 'BJ',
  START_CODE_MAX_ATTEMPTS: 5,
  END_CODE_MAX_ATTEMPTS: 5,
  VERIFICATION_TTL_HOURS: 24,
  ADULT_AGE: 18,
} as const;

/** MIME images MissionMedia (upload Client). */
export const MISSION_MEDIA_ALLOWED_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** Risk flags qui imposent minimumAge >= 18 sur la mission (règle produit V1). */
export const RISK_FLAGS_REQUIRE_ADULT: ReadonlySet<string> = new Set([
  'DRIVING',
  'ROAD_INTERVENTION',
  'WORK_AT_HEIGHT',
  'LIVE_ELECTRICAL_WORK',
  'HEAVY_MACHINERY',
  'HAZARDOUS_EQUIPMENT',
  'NIGHT_SECURITY',
]);

/** Slugs catalogue passés à 18+ (règle produit KingJOBS V1, pas conclusion juridique). */
export const CATALOG_ADULT_ONLY_SLUGS = [
  'chauffeur',
  'agent-securite',
  'gardien',
  'massage',
  'depannage-automobile',
  'montage-demontage-evenementiel',
  'technicien-evenementiel',
] as const;
