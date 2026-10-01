import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type MigrationFinding = {
  file: string;
  line: number;
  severity: 'destructive' | 'warning';
  pattern: string;
  excerpt: string;
};

const DESTRUCTIVE_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/i },
  { name: 'DROP SCHEMA', regex: /\bDROP\s+SCHEMA\b/i },
  { name: 'DROP DATABASE', regex: /\bDROP\s+DATABASE\b/i },
  { name: 'TRUNCATE', regex: /\bTRUNCATE\b/i },
  { name: 'DROP COLUMN', regex: /\bDROP\s+COLUMN\b/i },
  { name: 'ALTER DROP', regex: /\bALTER\s+TABLE\b[\s\S]{0,80}\bDROP\b/i },
  {
    name: 'DELETE FROM (unguarded)',
    regex: /\bDELETE\s+FROM\b(?![\s\S]{0,40}\bWHERE\b)/i,
  },
];

const WARNING_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: 'TYPE CHANGE',
    regex: /\bALTER\s+COLUMN\b.+\bTYPE\b/i,
  },
  {
    name: 'SET NOT NULL without default',
    regex: /\bSET\s+NOT\s+NULL\b/i,
  },
];

export function scanSqlContent(file: string, sql: string): MigrationFinding[] {
  const findings: MigrationFinding[] = [];
  const lines = sql.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: i + 1,
          severity: 'destructive',
          pattern: pattern.name,
          excerpt: trimmed.slice(0, 120),
        });
      }
    }
    for (const pattern of WARNING_PATTERNS) {
      if (pattern.regex.test(line)) {
        findings.push({
          file,
          line: i + 1,
          severity: 'warning',
          pattern: pattern.name,
          excerpt: trimmed.slice(0, 120),
        });
      }
    }
  }

  // Multiline DROP COLUMN / ALTER DROP
  for (const pattern of DESTRUCTIVE_PATTERNS.filter((p) =>
    p.name.includes('ALTER'),
  )) {
    if (pattern.regex.test(sql)) {
      const already = findings.some((f) => f.pattern === pattern.name);
      if (!already) {
        findings.push({
          file,
          line: 0,
          severity: 'destructive',
          pattern: pattern.name,
          excerpt: '(match multiligne)',
        });
      }
    }
  }

  return findings;
}

export function scanMigrationsDirectory(
  migrationsDir: string,
): MigrationFinding[] {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const findings: MigrationFinding[] = [];
  const entries = readdirSync(migrationsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sqlPath = join(migrationsDir, entry.name, 'migration.sql');
    if (!existsSync(sqlPath)) continue;
    const sql = readFileSync(sqlPath, 'utf8');
    findings.push(...scanSqlContent(sqlPath, sql));
  }

  return findings;
}

export type CheckMigrationsResult = {
  ok: boolean;
  findings: MigrationFinding[];
  destructiveCount: number;
  warningCount: number;
};

export function checkMigrations(
  migrationsDir: string,
  options?: { allowDestructive?: boolean },
): CheckMigrationsResult {
  const findings = scanMigrationsDirectory(migrationsDir);
  const destructiveCount = findings.filter(
    (f) => f.severity === 'destructive',
  ).length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const allowDestructive = options?.allowDestructive === true;

  return {
    ok: destructiveCount === 0 || allowDestructive,
    findings,
    destructiveCount,
    warningCount,
  };
}
