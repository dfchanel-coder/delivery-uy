// Regenerates migration 0001_init from the Prisma schema plus the hand-written
// SQL that Prisma cannot express (partial/functional unique indexes and CHECK
// constraints, DATABASE.md "Database-Enforced Integrity").
//
//   DATABASE_URL=... pnpm --filter @deliveryuy/database run migration:build
//
// The migration is committed, so this script only has to run when the schema or
// the hand-written SQL changes during PHASE 02. Later phases must never edit an
// applied migration: they add a new one (AGENTS.md section 96).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(packageRoot, 'prisma', 'schema.prisma');
const manualSqlPath = path.join(packageRoot, 'prisma', 'manual', '0001_init_constraints.sql');
const migrationDir = path.join(packageRoot, 'prisma', 'migrations', '0001_init');
const migrationPath = path.join(migrationDir, 'migration.sql');

if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') {
  console.error(
    'DATABASE_URL is required by the Prisma CLI. Set a throwaway value: ' +
      'DATABASE_URL=postgresql://user:pass@localhost:5432/db (no connection is opened).',
  );
  process.exit(1);
}

if (!existsSync(manualSqlPath)) {
  console.error(`Missing hand-written SQL at ${manualSqlPath}`);
  process.exit(1);
}

// The `prisma` command in node_modules/.bin is a shell shim, which Node cannot
// spawn on Windows. The CLI is a normal Node script, so it is invoked through
// the current interpreter instead: same behaviour on every platform and no
// dependency on a shell.
const prismaCli = path.join(packageRoot, 'node_modules', 'prisma', 'build', 'index.js');

if (!existsSync(prismaCli)) {
  console.error(`Prisma CLI not found at ${prismaCli}. Run \`pnpm install\` first.`);
  process.exit(1);
}

function prisma(args, options = {}) {
  return execFileSync(process.execPath, [prismaCli, ...args], {
    cwd: packageRoot,
    ...options,
  });
}

// A migration must never be written from a schema the CLI rejects.
prisma(['validate'], { stdio: 'inherit' });

const generated = prisma(
  [
    'migrate',
    'diff',
    '--from-empty',
    '--to-schema-datamodel',
    path.relative(packageRoot, schemaPath).split(path.sep).join('/'),
    '--script',
  ],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);

const manual = readFileSync(manualSqlPath, 'utf8');

mkdirSync(migrationDir, { recursive: true });
writeFileSync(migrationPath, `${generated.trimEnd()}\n\n${manual.trimStart()}`, 'utf8');

console.log(`Wrote ${path.relative(process.cwd(), migrationPath)}`);
