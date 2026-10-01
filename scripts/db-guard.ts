import { assertActionAllowed, buildSafetyContextFromEnv, DbSafetyError, redactDatabaseUrl } from '../src/common/db/db-safety';
import { checkMigrations } from '../src/common/db/check-migrations';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Charge `.env` local sans écraser les variables déjà exportées dans le shell. */
function loadDotEnvFile(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (
      key === 'DATABASE_ENV' ||
      key === 'DATABASE_URL' ||
      key === 'DIRECT_URL' ||
      key === 'SHADOW_DATABASE_URL' ||
      key === 'TEST_DATABASE_URL' ||
      key === 'KINGJOBS_PROD_DB_HOSTS' ||
      key === 'ALLOW_DESTRUCTIVE_MIGRATION'
    ) {
      // Les scripts db:* privilégient le `.env` local (évite un export shell prod accidentel).
      process.env[key] = value;
    } else if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile();

type Mode =
  | 'migrate-dev'
  | 'migrate-reset'
  | 'migrate-deploy'
  | 'migrate-diff'
  | 'seed-catalog'
  | 'check-migrations'
  | 'assert-test'
  | 'status';

function usage(): never {
  // eslint-disable-next-line no-console
  console.error(`Usage: ts-node scripts/db-guard.ts <mode> [-- ...prisma args]

Modes:
  migrate-dev       Guard + prisma migrate dev
  migrate-reset     Guard (test only) + prisma migrate reset
  migrate-deploy    Guard env + prisma migrate deploy
  migrate-diff      Guard shadow + prisma migrate diff
  seed-catalog      Catalogue reference seed (idempotent, no demo users)
  check-migrations  Scan SQL for destructive statements
  assert-test       Fail if DB looks like production
  status            Print redacted DB safety status
`);
  process.exit(2);
}

function runPrisma(args: string[]): void {
  const result = spawnSync('npx', ['prisma', ...args], {
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}

function withShadowArgs(args: string[]): string[] {
  const shadow = process.env.SHADOW_DATABASE_URL?.trim();
  if (!shadow) return args;
  // Prisma CLI: --shadow-database-url for migrate dev / diff
  if (args.includes('--shadow-database-url')) return args;
  return ['--shadow-database-url', shadow, ...args];
}

function main(): void {
  const mode = process.argv[2] as Mode | undefined;
  const passthrough = process.argv.slice(3);
  if (passthrough[0] === '--') passthrough.shift();

  if (!mode) usage();

  const ctx = buildSafetyContextFromEnv();

  try {
    switch (mode) {
      case 'status': {
        // eslint-disable-next-line no-console
        console.log(
          JSON.stringify(
            {
              DATABASE_ENV: process.env.DATABASE_ENV ?? null,
              NODE_ENV: process.env.NODE_ENV ?? null,
              DATABASE_URL: redactDatabaseUrl(process.env.DATABASE_URL),
              DIRECT_URL: redactDatabaseUrl(process.env.DIRECT_URL),
              SHADOW_DATABASE_URL: redactDatabaseUrl(
                process.env.SHADOW_DATABASE_URL,
              ),
              TEST_DATABASE_URL: redactDatabaseUrl(
                process.env.TEST_DATABASE_URL,
              ),
            },
            null,
            2,
          ),
        );
        return;
      }
      case 'check-migrations': {
        const allow =
          process.env.ALLOW_DESTRUCTIVE_MIGRATION === 'true';
        if (allow) {
          // eslint-disable-next-line no-console
          console.warn(
            '⚠️  ALLOW_DESTRUCTIVE_MIGRATION=true — revue manuelle obligatoire.',
          );
        }
        const dir = join(process.cwd(), 'prisma', 'migrations');
        const result = checkMigrations(dir, { allowDestructive: allow });
        for (const f of result.findings) {
          // eslint-disable-next-line no-console
          console.log(
            `[${f.severity}] ${f.file}:${f.line} ${f.pattern} :: ${f.excerpt}`,
          );
        }
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.error(
            `Échec : ${result.destructiveCount} instruction(s) destructive(s) détectée(s).`,
          );
          process.exit(1);
        }
        // eslint-disable-next-line no-console
        console.log(
          `OK — migrations scannées (${result.warningCount} warning(s)).`,
        );
        return;
      }
      case 'assert-test':
        assertActionAllowed('test-db', ctx);
        // eslint-disable-next-line no-console
        console.log('OK — contexte test DB accepté (ou in-memory).');
        return;
      case 'migrate-dev':
        assertActionAllowed('migrate-dev', ctx);
        runPrisma(['migrate', 'dev', ...withShadowArgs(passthrough)]);
        return;
      case 'migrate-reset':
        assertActionAllowed('migrate-reset', ctx);
        runPrisma(['migrate', 'reset', ...passthrough]);
        return;
      case 'migrate-diff':
        assertActionAllowed('migrate-diff-shadow', ctx);
        runPrisma(['migrate', 'diff', ...withShadowArgs(passthrough)]);
        return;
      case 'migrate-deploy': {
        if (!(process.env.DATABASE_ENV ?? '').trim()) {
          throw new DbSafetyError(
            'Refusé : db:prod:deploy exige DATABASE_ENV (production|development). Fail-closed.',
          );
        }
        runPrisma(['migrate', 'deploy', ...passthrough]);
        return;
      }
      case 'seed-catalog': {
        // Reference data only — allowed on production with DATABASE_ENV=production
        const env = (process.env.DATABASE_ENV ?? '').toLowerCase();
        if (!env) {
          throw new DbSafetyError(
            'Refusé : seed catalogue exige DATABASE_ENV explicite.',
          );
        }
        if (env !== 'production' && env !== 'development' && env !== 'test') {
          throw new DbSafetyError(`DATABASE_ENV invalide: ${env}`);
        }
        const result = spawnSync(
          'npx',
          ['ts-node', '--transpile-only', 'prisma/seed.ts'],
          { stdio: 'inherit', env: process.env, shell: process.platform === 'win32' },
        );
        process.exit(result.status ?? 1);
        return;
      }
      default:
        usage();
    }
  } catch (error) {
    const message =
      error instanceof DbSafetyError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    // eslint-disable-next-line no-console
    console.error(`DB SAFETY: ${message}`);
    process.exit(1);
  }
}

main();
