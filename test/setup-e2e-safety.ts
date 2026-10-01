/**
 * Garde-fou e2e :
 * - Neutralise toute URL qui ressemble à Neon production (e2e = mémoire / mocks).
 * - Refuse un run explicite contre la prod (`E2E_USE_REAL_DATABASE=true` + host prod).
 *
 * Les e2e missions utilisent InMemoryPrisma — aucune écriture Neon.
 */
import {
  buildSafetyContextFromEnv,
  DbSafetyError,
  hostLooksLikeProduction,
  parseDatabaseUrl,
  redactDatabaseUrl,
  resolveProdHostMarkers,
} from '../src/common/db/db-safety';

const SAFE_E2E_URL =
  'postgresql://e2e:e2e@127.0.0.1:5432/kingjobs_e2e?schema=public';

beforeAll(() => {
  const ctx = buildSafetyContextFromEnv();
  const markers = resolveProdHostMarkers(ctx.prodHostMarkers);
  const useReal = process.env.E2E_USE_REAL_DATABASE === 'true';

  for (const key of [
    'DATABASE_URL',
    'DIRECT_URL',
    'TEST_DATABASE_URL',
    'SHADOW_DATABASE_URL',
  ] as const) {
    const value = process.env[key];
    if (!value) continue;
    try {
      const { host } = parseDatabaseUrl(value);
      if (!hostLooksLikeProduction(host, markers)) continue;

      if (useReal) {
        throw new DbSafetyError(
          `E2E refusé : E2E_USE_REAL_DATABASE=true avec ${key} production (${redactDatabaseUrl(value)}).`,
        );
      }

      console.warn(
        `[e2e-safety] ${key} production détectée — neutralisée pour les tests mémoire/mocks.`,
      );
      if (key === 'SHADOW_DATABASE_URL') {
        delete process.env.SHADOW_DATABASE_URL;
      } else {
        process.env[key] = SAFE_E2E_URL;
      }
    } catch (error) {
      if (error instanceof DbSafetyError) throw error;
    }
  }

  if (
    (process.env.DATABASE_ENV ?? '').toLowerCase() === 'production' &&
    useReal
  ) {
    throw new DbSafetyError(
      'E2E refusé : DATABASE_ENV=production avec E2E_USE_REAL_DATABASE=true.',
    );
  }

  if ((process.env.DATABASE_ENV ?? '').toLowerCase() === 'production') {
    process.env.DATABASE_ENV = 'test';
  }

  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
});
