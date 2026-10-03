import { checkMigrations, scanSqlContent } from './check-migrations';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('check-migrations', () => {
  it('detects DROP TABLE', () => {
    const findings = scanSqlContent(
      'x.sql',
      'CREATE TABLE a(id int);\nDROP TABLE a;\n',
    );
    expect(findings.some((f) => f.pattern === 'DROP TABLE')).toBe(true);
  });

  it('detects TRUNCATE', () => {
    const findings = scanSqlContent('x.sql', 'TRUNCATE users;');
    expect(findings.some((f) => f.pattern === 'TRUNCATE')).toBe(true);
  });

  it('accepts safe additive migration', () => {
    const findings = scanSqlContent(
      'safe.sql',
      `CREATE TYPE "Foo" AS ENUM ('A');\nCREATE TABLE "foos" ("id" UUID NOT NULL);\n`,
    );
    expect(findings.filter((f) => f.severity === 'destructive')).toHaveLength(
      0,
    );
  });

  it('accepts DROP NOT NULL (nullable columns are additive)', () => {
    const findings = scanSqlContent(
      'nullable.sql',
      `ALTER TABLE "users"\n  ALTER COLUMN "email" DROP NOT NULL;\n\nALTER TABLE "users"\n  ALTER COLUMN "date_of_birth" DROP NOT NULL;\n`,
    );
    expect(findings.filter((f) => f.severity === 'destructive')).toHaveLength(
      0,
    );
  });

  it('still detects ALTER TABLE DROP COLUMN across lines', () => {
    const findings = scanSqlContent(
      'drop-col.sql',
      `ALTER TABLE "users"\n  DROP COLUMN "legacy_field";\n`,
    );
    expect(
      findings.some(
        (f) =>
          f.severity === 'destructive' &&
          (f.pattern === 'DROP COLUMN' || f.pattern === 'ALTER DROP'),
      ),
    ).toBe(true);
  });

  it('fails directory scan on destructive SQL unless override', () => {
    const root = mkdtempSync(join(tmpdir(), 'kj-mig-'));
    const dir = join(root, '20260101000000_bad');
    mkdirSync(dir);
    writeFileSync(join(dir, 'migration.sql'), 'DROP TABLE "users";\n');

    const blocked = checkMigrations(root);
    expect(blocked.ok).toBe(false);
    expect(blocked.destructiveCount).toBeGreaterThan(0);

    const allowed = checkMigrations(root, { allowDestructive: true });
    expect(allowed.ok).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});
