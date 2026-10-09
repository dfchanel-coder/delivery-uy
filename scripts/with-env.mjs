#!/usr/bin/env node
// Loads the repository `.env` into the environment and runs a command.
//
// Node can read a dotenv file (`process.loadEnvFile`, the same parser as
// `--env-file`), but only for a Node entrypoint. Prisma and the Nest CLI are
// binaries pnpm runs directly, so nothing loads the file for them and a
// developer who follows the quickstart (`cp .env.example .env`) would still see
// "DATABASE_URL is required". This wrapper is that one place, for every root
// script that needs configuration.
//
// It never overrides a variable that is already set: CI and a developer who
// exported a value keep control, exactly like `--env-file`. The `.env` file is
// optional, so the same scripts work on a clean CI checkout.
//
// Usage: node scripts/with-env.mjs -- <command> [args...]

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(repoRoot, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const separator = process.argv.indexOf('--');
const command = separator === -1 ? [] : process.argv.slice(separator + 1);

if (command.length === 0) {
  console.error('Usage: node scripts/with-env.mjs -- <command> [args...]');
  process.exit(2);
}

// On Windows `pnpm` is a `.cmd` shim, which Node can only execute through a
// shell. The command is static, defined in `package.json`, and none of its
// tokens contain spaces, so joining them into one line is safe and avoids the
// `DEP0190` warning about an args array combined with `shell: true`.
const child = spawn(command.join(' '), {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
  shell: true,
});

child.on('error', (error) => {
  console.error(`Could not run ${command[0]}: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal !== null) {
    // Forward the termination so a supervisor sees why the child stopped.
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
