#!/usr/bin/env node
// Dart/Flutter quality gate for every Dart workspace in the repository.
//
// The TypeScript side runs through pnpm; Dart has its own toolchain, so this
// script walks the known Dart workspaces and runs `flutter analyze` plus
// `flutter test` in each one. It exits non-zero on the first failing workspace
// and prints an actionable message when Flutter is not installed.
//
// Usage: node scripts/flutter-check.mjs

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// On Windows `flutter` is a `flutter.bat` shim, which Node can only execute
// through a shell. The arguments are static, so there is no injection risk.
const isWindows = process.platform === 'win32';
const flutterCommand = isWindows ? 'flutter.bat' : 'flutter';
const spawnOptions = { shell: isWindows };

const workspaces = ['packages/dart/core', 'apps/customer', 'apps/merchant', 'apps/driver'];

const missing = workspaces.filter((workspace) => !existsSync(path.join(repoRoot, workspace)));

if (missing.length > 0) {
  console.error(`Missing Dart workspaces: ${missing.join(', ')}`);
  process.exit(1);
}

const probe = spawnSync(flutterCommand, ['--version'], {
  ...spawnOptions,
  stdio: 'ignore',
});

if (probe.error !== undefined && probe.error.code === 'ENOENT') {
  console.error(
    [
      'Flutter was not found on PATH.',
      'Install the Flutter SDK (https://docs.flutter.dev/get-started/install) and run',
      '`flutter --version` once, then re-run `pnpm run flutter:check`.',
    ].join('\n'),
  );
  process.exit(1);
}

let failures = 0;

for (const workspace of workspaces) {
  const cwd = path.join(repoRoot, workspace);

  for (const [label, args] of [
    ['analyze', ['analyze']],
    ['test', ['test']],
  ]) {
    console.log(`\n> ${workspace}: flutter ${args.join(' ')}`);
    const result = spawnSync(flutterCommand, args, {
      ...spawnOptions,
      cwd,
      stdio: 'inherit',
    });

    if (result.status !== 0) {
      console.error(`${workspace}: flutter ${label} failed (exit ${String(result.status)})`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`\nDart quality gate failed: ${String(failures)} check(s) did not pass.`);
  process.exit(1);
}

console.log('\nDart quality gate passed.');
