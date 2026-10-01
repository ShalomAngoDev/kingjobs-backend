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
