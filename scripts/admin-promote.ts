/**
 * Bootstrap / promotion d'un User existant en SUPER_ADMIN.
 *
 * Usage :
 *   npm run admin:promote -- --email=user@example.com --confirm
 *   npm run admin:promote -- --email=user@example.com --confirm --confirm-production
 *
 * - Pas d'endpoint HTTP.
 * - Ne crée jamais d'utilisateur.
 * - Ne modifie ni mot de passe, ni sessions, ni profils Client/Jobber.
 * - Production : exige --confirm-production.
 */
import { PrismaClient, UserRole } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildSafetyContextFromEnv,
  classifyDatabaseRole,
  parseDatabaseUrl,
  redactDatabaseUrl,
  resolveProdHostMarkers,
  hostLooksLikeProduction,
} from '../src/common/db/db-safety';
import { normalizeEmail } from '../src/common/utils/email-normalize';

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
    // Aligné db-guard : privilégier .env pour les clés DB de sécurité.
    if (
      key === 'DATABASE_ENV' ||
      key === 'DATABASE_URL' ||
      key === 'DIRECT_URL' ||
      key === 'SHADOW_DATABASE_URL' ||
      key === 'TEST_DATABASE_URL' ||
      key === 'KINGJOBS_PROD_DB_HOSTS'
    ) {
      process.env[key] = value;
    } else if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnvFile();

type Args = {
  email?: string;
  confirm: boolean;
  confirmProduction: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    confirm: false,
    confirmProduction: false,
    help: false,
  };
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      args.help = true;
      continue;
    }
    if (raw === '--confirm') {
      args.confirm = true;
      continue;
    }
    if (raw === '--confirm-production') {
      args.confirmProduction = true;
      continue;
    }
    if (raw.startsWith('--email=')) {
      args.email = raw.slice('--email='.length);
      continue;
    }
    if (raw === '--email') {
      throw new Error('Utilisez --email=<adresse> (valeur obligatoire).');
    }
    throw new Error(`Argument inconnu : ${raw}`);
  }
  return args;
}

function usage(): never {
  // eslint-disable-next-line no-console
  console.error(`Usage:
  npm run admin:promote -- --email=<email> --confirm
  npm run admin:promote -- --email=<email> --confirm --confirm-production

Promouvoit un User EXISTANT en SUPER_ADMIN (idempotent).
N'affiche jamais DATABASE_URL ni credentials.
Production : --confirm-production obligatoire.`);
  process.exit(2);
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '(invalid)';
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    usage();
  }

  if (args.help || !args.email) {
    usage();
  }

  const emailNormalized = normalizeEmail(args.email);
  if (!emailNormalized.includes('@')) {
    // eslint-disable-next-line no-console
    console.error('Email invalide.');
    process.exit(1);
  }

  const ctx = buildSafetyContextFromEnv();
  const role = classifyDatabaseRole(ctx);
  const databaseEnv = (process.env.DATABASE_ENV ?? '(unset)').trim();

  if (!process.env.DATABASE_URL?.trim()) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL manquante.');
    process.exit(1);
  }

  // Interdit d'utiliser shadow / test comme cible de promotion.
  if (process.env.SHADOW_DATABASE_URL?.trim()) {
    try {
      const primary = parseDatabaseUrl(process.env.DATABASE_URL);
      const shadow = parseDatabaseUrl(process.env.SHADOW_DATABASE_URL);
      if (primary.fingerprint === shadow.fingerprint) {
        // eslint-disable-next-line no-console
        console.error(
          'Refus : DATABASE_URL pointe vers la même base que SHADOW_DATABASE_URL.',
        );
        process.exit(1);
      }
    } catch {
      // parse échoué → db-safety affichera ailleurs ; on continue prudemment
    }
  }

  if (role === 'test') {
    // eslint-disable-next-line no-console
    console.error(
      'Refus : environnement test. Ne pas promouvoir un SUPER_ADMIN sur une base de test.',
    );
    process.exit(1);
  }

  const markers = resolveProdHostMarkers(process.env.KINGJOBS_PROD_DB_HOSTS);
  let hostIsProd = false;
  try {
    hostIsProd = hostLooksLikeProduction(
      parseDatabaseUrl(process.env.DATABASE_URL).host,
      markers,
    );
  } catch {
    hostIsProd = false;
  }

  const isProduction = role === 'production' || hostIsProd;

  // eslint-disable-next-line no-console
  console.log('KingJOBS admin:promote');
  // eslint-disable-next-line no-console
  console.log(`  DATABASE_ENV : ${databaseEnv}`);
  // eslint-disable-next-line no-console
  console.log(`  rôle détecté : ${role}${hostIsProd ? ' (host production)' : ''}`);
  // eslint-disable-next-line no-console
  console.log(`  cible email  : ${maskEmail(emailNormalized)}`);
  // Jamais afficher l'URL complète avec credentials — redaction uniquement si debug local.
  if (process.env.ADMIN_PROMOTE_SHOW_REDACTED_URL === '1') {
    // eslint-disable-next-line no-console
    console.log(`  DATABASE_URL : ${redactDatabaseUrl(process.env.DATABASE_URL)}`);
  }

  if (!args.confirm) {
    // eslint-disable-next-line no-console
    console.error('Refus : ajoutez --confirm pour exécuter la promotion.');
    process.exit(1);
  }

  if (isProduction && !args.confirmProduction) {
    // eslint-disable-next-line no-console
    console.error(
      'Refus : cible production détectée. Ajoutez --confirm-production.',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { emailNormalized },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      // eslint-disable-next-line no-console
      console.error('Utilisateur introuvable pour cet email. Aucune création.');
      process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(
      `  trouvé : ${user.firstName} ${user.lastName} | role=${user.role} | status=${user.status}`,
    );

    if (user.role === UserRole.SUPER_ADMIN) {
      // eslint-disable-next-line no-console
      console.log('Déjà SUPER_ADMIN — aucune modification (idempotent).');
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { role: UserRole.SUPER_ADMIN },
      select: { id: true },
    });

    // eslint-disable-next-line no-console
    console.log(`OK : ${user.role} → SUPER_ADMIN`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
