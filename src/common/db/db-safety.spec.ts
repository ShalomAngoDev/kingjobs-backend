import {
  assertActionAllowed,
  assertNotProduction,
  assertShadowSafe,
  classifyDatabaseRole,
  DbSafetyError,
  hostLooksLikeProduction,
  parseDatabaseUrl,
  redactDatabaseUrl,
} from './db-safety';

describe('db-safety', () => {
  const prodUrl =
    'postgresql://u:p@ep-orange-pine-za4ezsuf.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require';
  const devUrl =
    'postgresql://u:p@ep-dev-branch-xxxx.c-2.eu-west-2.aws.neon.tech/neondb?sslmode=require';
  const testUrl =
    'postgresql://u:p@ep-test-branch-yyyy.c-2.eu-west-2.aws.neon.tech/neondb_test?sslmode=require';

  it('redacts credentials from URLs', () => {
    const redacted = redactDatabaseUrl(prodUrl);
    expect(redacted).not.toContain(':p@');
    expect(redacted).toContain('***');
    expect(redacted).not.toMatch(/:p(?:@|$)/);
  });

  it('classifies production via DATABASE_ENV', () => {
    expect(
      classifyDatabaseRole({ databaseEnv: 'production', databaseUrl: devUrl }),
    ).toBe('production');
  });

  it('classifies production via known host marker', () => {
    expect(classifyDatabaseRole({ databaseUrl: prodUrl })).toBe('production');
  });

  it('production detected → reset refused', () => {
    expect(() =>
      assertActionAllowed('migrate-reset', {
        databaseEnv: 'production',
        databaseUrl: prodUrl,
      }),
    ).toThrow(DbSafetyError);
  });

  it('production detected → test DB refused', () => {
    expect(() =>
      assertActionAllowed('test-db', {
        databaseEnv: 'production',
        databaseUrl: prodUrl,
        nodeEnv: 'test',
      }),
    ).toThrow(/production/i);
  });

  it('production detected → migrate-dev refused', () => {
    expect(() =>
      assertActionAllowed('migrate-dev', {
        databaseEnv: 'production',
        databaseUrl: prodUrl,
        shadowDatabaseUrl: testUrl,
      }),
    ).toThrow(DbSafetyError);
  });

  it('unknown DB → destructive refused (fail-closed)', () => {
    expect(() =>
      assertNotProduction(
        { databaseUrl: 'postgresql://u:p@localhost:5432/mystery' },
        'migrate reset',
      ),
    ).toThrow(/inconnu|unknown|fail-closed/i);
  });

  it('seed-demo refused against production', () => {
    expect(() =>
      assertActionAllowed('seed-demo', {
        databaseEnv: 'production',
        databaseUrl: prodUrl,
      }),
    ).toThrow(DbSafetyError);
  });

  it('seed-demo allowed on development', () => {
    expect(() =>
      assertActionAllowed('seed-demo', {
        databaseEnv: 'development',
        databaseUrl: devUrl,
      }),
    ).not.toThrow();
  });

  it('dev DB → migrate-dev allowed with safe shadow', () => {
    expect(() =>
      assertActionAllowed('migrate-dev', {
        databaseEnv: 'development',
        databaseUrl: devUrl,
        directUrl: devUrl,
        shadowDatabaseUrl: testUrl,
      }),
    ).not.toThrow();
  });

  it('shadow pointing to production is refused', () => {
    expect(() =>
      assertShadowSafe({
        databaseEnv: 'development',
        databaseUrl: devUrl,
        shadowDatabaseUrl: prodUrl,
      }),
    ).toThrow(/SHADOW|production/i);
  });

  it('missing shadow refused for migrate-dev', () => {
    expect(() =>
      assertActionAllowed('migrate-dev', {
        databaseEnv: 'development',
        databaseUrl: devUrl,
      }),
    ).toThrow(/SHADOW_DATABASE_URL/);
  });

  it('db-push-force always refused', () => {
    expect(() =>
      assertActionAllowed('db-push-force', {
        databaseEnv: 'test',
        databaseUrl: testUrl,
      }),
    ).toThrow(/interdit/);
  });

  it('host marker matching works', () => {
    expect(
      hostLooksLikeProduction('ep-orange-pine-za4ezsuf-pooler.neon.tech', [
        'ep-orange-pine-za4ezsuf',
      ]),
    ).toBe(true);
  });

  it('fingerprint never includes password', () => {
    const parts = parseDatabaseUrl(prodUrl);
    expect(parts.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(parts.fingerprint).not.toContain('p');
  });
});
