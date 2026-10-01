import { createHash } from 'node:crypto';

export type DatabaseRole = 'production' | 'development' | 'test' | 'unknown';

export type DbUrlParts = {
  host: string;
  database: string;
  /** host:database fingerprint — never includes credentials */
  fingerprint: string;
};

export type SafetyContext = {
  databaseEnv?: string | null;
  databaseUrl?: string | null;
  directUrl?: string | null;
  shadowDatabaseUrl?: string | null;
  testDatabaseUrl?: string | null;
  /** Comma-separated Neon/host identifiers known to be production (no passwords). */
  prodHostMarkers?: string | null;
  nodeEnv?: string | null;
};

export class DbSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbSafetyError';
  }
}

/** Redacts credentials from a connection string for safe display. */
export function redactDatabaseUrl(url: string | null | undefined): string {
  if (!url) return '(empty)';
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = '***';
    return parsed.toString();
  } catch {
    return '(unparseable-url)';
  }
}

export function parseDatabaseUrl(url: string): DbUrlParts {
  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  const database = (parsed.pathname.replace(/^\//, '') || '').toLowerCase();
  const fingerprint = createHash('sha256')
    .update(`${host}/${database}`)
    .digest('hex')
    .slice(0, 16);
  return { host, database, fingerprint };
}

/**
 * Known KingJOBS production Neon endpoint host markers (no secrets).
 * Compare hostnames only — never full URLs.
 */
export const DEFAULT_PROD_HOST_MARKERS = ['ep-orange-pine-za4ezsuf'] as const;

export function resolveProdHostMarkers(
  raw: string | null | undefined,
): string[] {
  const fromEnv = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return [...DEFAULT_PROD_HOST_MARKERS];
}

export function hostLooksLikeProduction(
  host: string,
  markers: string[],
): boolean {
  const h = host.toLowerCase();
  return markers.some((marker) => h.includes(marker.toLowerCase()));
}

export function classifyDatabaseRole(ctx: SafetyContext): DatabaseRole {
  const explicit = (ctx.databaseEnv ?? '').trim().toLowerCase();
  if (
    explicit === 'production' ||
    explicit === 'development' ||
    explicit === 'test'
  ) {
    return explicit;
  }

  const url = ctx.databaseUrl || ctx.directUrl;
  if (!url) return 'unknown';

  try {
    const { host } = parseDatabaseUrl(url);
    const markers = resolveProdHostMarkers(ctx.prodHostMarkers);
    if (hostLooksLikeProduction(host, markers)) {
      return 'production';
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

export function assertNotProduction(
  ctx: SafetyContext,
  action: string,
): DatabaseRole {
  const role = classifyDatabaseRole(ctx);
  if (role === 'production') {
    throw new DbSafetyError(
      `Refusé : « ${action} » est interdit contre une base production. ` +
        `Utilisez une branche Neon development/test. (DATABASE_ENV=${ctx.databaseEnv ?? 'unset'})`,
    );
  }
  if (role === 'unknown') {
    throw new DbSafetyError(
      `Refusé : environnement DB inconnu pour « ${action} » (fail-closed). ` +
        `Définissez DATABASE_ENV=development|test et une URL non-production.`,
    );
  }
  return role;
}

export function assertProductionDeploy(ctx: SafetyContext): void {
  const role = classifyDatabaseRole(ctx);
  if (
    role !== 'production' &&
    (ctx.databaseEnv ?? '').toLowerCase() !== 'production'
  ) {
    // Allow deploy when DATABASE_ENV=production even if host markers not loaded
    if ((ctx.databaseEnv ?? '').toLowerCase() === 'production') return;
  }
  if ((ctx.databaseEnv ?? '').toLowerCase() === 'production') return;

  // migrate deploy on non-prod is OK (staging) — only require explicit env
  if (role === 'unknown' && !(ctx.databaseEnv ?? '').trim()) {
    throw new DbSafetyError(
      'Refusé : db:prod:deploy exige DATABASE_ENV=production (ou development/staging explicite). ' +
        'Fail-closed — environnement non déterminé.',
    );
  }
}

export function assertShadowSafe(ctx: SafetyContext): void {
  const shadow = ctx.shadowDatabaseUrl?.trim();
  if (!shadow) {
    throw new DbSafetyError(
      'Refusé : SHADOW_DATABASE_URL est requis pour migrate dev / migrate diff. ' +
        'Ne pointez JAMAIS la shadow vers Neon production.',
    );
  }

  const markers = resolveProdHostMarkers(ctx.prodHostMarkers);
  try {
    const { host: shadowHost } = parseDatabaseUrl(shadow);
    if (hostLooksLikeProduction(shadowHost, markers)) {
      throw new DbSafetyError(
        'Refusé : SHADOW_DATABASE_URL pointe vers un host production connu. ' +
          'Utilisez une branche Neon dédiée « shadow » / « test ».',
      );
    }

    const primary = ctx.directUrl || ctx.databaseUrl;
    if (primary) {
      const { host: primaryHost, database: primaryDb } =
        parseDatabaseUrl(primary);
      const { database: shadowDb } = parseDatabaseUrl(shadow);
      if (
        shadowHost === primaryHost &&
        shadowDb === primaryDb &&
        hostLooksLikeProduction(primaryHost, markers)
      ) {
        throw new DbSafetyError(
          'Refusé : SHADOW_DATABASE_URL est identique à la base production.',
        );
      }
    }
  } catch (error) {
    if (error instanceof DbSafetyError) throw error;
    throw new DbSafetyError(
      `Refusé : SHADOW_DATABASE_URL invalide (${(error as Error).message}).`,
    );
  }
}

export function assertTestDatabase(ctx: SafetyContext): void {
  const nodeEnv = (ctx.nodeEnv ?? '').toLowerCase();
  if (nodeEnv && nodeEnv !== 'test') {
    throw new DbSafetyError(
      `Refusé : tests DB exigent NODE_ENV=test (reçu « ${nodeEnv || 'unset'} »).`,
    );
  }

  const role = classifyDatabaseRole({
    ...ctx,
    databaseUrl: ctx.testDatabaseUrl || ctx.databaseUrl,
  });

  if (role === 'production') {
    throw new DbSafetyError(
      'Refusé : la base de test ressemble à la production.',
    );
  }

  // Prefer explicit DATABASE_ENV=test when a real TEST_DATABASE_URL is used
  const env = (ctx.databaseEnv ?? '').toLowerCase();
  if (ctx.testDatabaseUrl && env && env !== 'test') {
    throw new DbSafetyError(
      'Refusé : TEST_DATABASE_URL défini mais DATABASE_ENV ≠ test.',
    );
  }

  if (role === 'unknown' && env !== 'test' && !ctx.testDatabaseUrl) {
    // In-memory e2e (no real URL) is fine — caller decides
    return;
  }

  if (role === 'unknown' && env !== 'test') {
    throw new DbSafetyError(
      'Refusé : DB de test non identifiable (fail-closed). Définissez DATABASE_ENV=test.',
    );
  }
}

export function buildSafetyContextFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SafetyContext {
  return {
    databaseEnv: env.DATABASE_ENV,
    databaseUrl: env.DATABASE_URL,
    directUrl: env.DIRECT_URL,
    shadowDatabaseUrl: env.SHADOW_DATABASE_URL,
    testDatabaseUrl: env.TEST_DATABASE_URL,
    prodHostMarkers: env.KINGJOBS_PROD_DB_HOSTS,
    nodeEnv: env.NODE_ENV,
  };
}

export type DangerousAction =
  | 'migrate-dev'
  | 'migrate-reset'
  | 'db-push-force'
  | 'migrate-diff-shadow'
  | 'test-db'
  | 'seed-demo';

export function assertActionAllowed(
  action: DangerousAction,
  ctx: SafetyContext = buildSafetyContextFromEnv(),
): void {
  switch (action) {
    case 'migrate-dev':
      assertNotProduction(ctx, 'prisma migrate dev');
      assertShadowSafe(ctx);
      break;
    case 'migrate-reset':
      assertNotProduction(ctx, 'prisma migrate reset');
      if (classifyDatabaseRole(ctx) !== 'test') {
        throw new DbSafetyError(
          'Refusé : migrate reset uniquement si DATABASE_ENV=test.',
        );
      }
      break;
    case 'db-push-force':
      throw new DbSafetyError(
        'Refusé : prisma db push --force-reset est interdit via les scripts du repository.',
      );
    case 'migrate-diff-shadow':
      assertShadowSafe(ctx);
      break;
    case 'test-db':
      assertTestDatabase(ctx);
      break;
    case 'seed-demo':
      assertNotProduction(ctx, 'seed démo / fixtures utilisateurs');
      break;
    default:
      throw new DbSafetyError(`Action inconnue: ${String(action)}`);
  }
}
