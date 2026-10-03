/**
 * Verifies the infrastructure-dependent exit criteria in one place.
 *
 * PHASE 01 criterion 5, PHASE 02 and the Redis/PostgreSQL half of PHASE 03 all
 * need the same thing: a real PostgreSQL and a real Redis, plus a running API.
 * Until now the CI `integration` job expressed that as a list of `run:` blocks,
 * which meant the only way to check them was to push and read a log. This script
 * is that list, callable, so a developer with reachable endpoints runs exactly
 * what CI runs.
 *
 * The steps, in order, and the criterion each one settles:
 *
 *   1. prisma generate                 the client the next steps need
 *   2. prisma migrate deploy           the DDL and the hand-written constraints
 *                                      are valid against a real server, and the
 *                                      hand-written partial/functional indexes
 *                                      and CHECK constraints do not conflict
 *   3. prisma migrate status           no migration is left pending, which is
 *                                      what "applied" means
 *   4. db:seed, twice, with assertions the seed is idempotent and writes real
 *      Argon2id digests rather than placeholders
 *   5. test:integration                the Prisma adapters and the Redis limiter,
 *      plus the skip assertion, because every spec skips itself when its
 *      dependency is missing and a green run alone proves nothing ran
 *   6. boot the API and read both health probes
 *                                      PHASE 01 criterion 5: liveness without
 *                                      infrastructure and readiness with it
 *
 * What it does not settle, and what no amount of running this settles: that the
 * compose files bring those servers up. That needs a container runtime, and the
 * remaining gap is recorded in PROJECT_STATE.md rather than papered over here.
 *
 * Usage:
 *   DATABASE_URL=... REDIS_URL=... node scripts/verify-infrastructure.mjs
 *   DATABASE_URL=... REDIS_URL=... node scripts/verify-infrastructure.mjs --from 5
 *
 * `--from <n>` starts at a step, for iterating on a later step without paying
 * for the earlier ones. Every step before it is reported as skipped rather than
 * passed, so a partial run can never be mistaken for a full one.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

/** The repository root, from this file's own location. */
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const STEPS = [
  { name: 'prisma generate', proves: 'the generated client matches the schema' },
  { name: 'prisma migrate deploy', proves: 'the DDL applies to a real PostgreSQL' },
  { name: 'prisma migrate status', proves: 'no migration is left pending' },
  { name: 'seed twice and assert', proves: 'the seed is idempotent and writes real hashes' },
  { name: 'integration suite', proves: 'the Prisma adapters and the Redis limiter' },
  { name: 'API health probes', proves: 'PHASE 01 criterion 5' },
];

const REQUIRED_ENVIRONMENT = ['DATABASE_URL', 'REDIS_URL'];

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

/**
 * Runs a command to completion.
 *
 * `shell` is opt-in because only one kind of command needs it. On Windows a
 * `.cmd` shim cannot be spawned without it, but the shell then splits the command
 * line on spaces, which breaks any executable path that contains them -
 * `C:\Program Files\nodejs\node.exe` being the one this script needs on every
 * platform. A rejected command must fail the step, not let it continue.
 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: options.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: options.shell === true,
      env: process.env,
    });

    let captured = '';

    if (options.quiet) {
      child.stdout?.on('data', (chunk) => {
        captured += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        captured += chunk.toString();
      });
    }

    child.on('error', (error) => fail(`${command} could not start: ${error.message}`));
    child.on('close', (code) => resolve({ code: code ?? 1, output: captured }));
  });
}

/** Runs a repository script through pnpm, which needs a shell on Windows. */
function pnpm(args) {
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { shell: true });
}

/** Runs a repository script with this Node, keeping the output for the report. */
function nodeScript(script, args = []) {
  return run(process.execPath, [join(repositoryRoot, script), ...args], { quiet: true });
}

async function step(index, title, body) {
  const descriptor = STEPS[index - 1];

  console.log(`\n[${index}/${STEPS.length}] ${descriptor.name}`);
  console.log(`      proves: ${descriptor.proves}`);

  const started = Date.now();

  try {
    await body();
  } catch (error) {
    fail(`${title}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`      ok in ${seconds}s`);
}

async function verifySeedIsIdempotent(workspace) {
  const first = await pnpm(['run', 'db:seed']);

  if (first.code !== 0) fail('the first seed run failed');

  const snapshot = join(workspace, 'seed-1.json');
  const assertion = await nodeScript('packages/database/scripts/assert-seeded-users.mjs', [
    '--snapshot',
    snapshot,
  ]);

  if (assertion.code !== 0) fail(`the seeded accounts are wrong:\n${assertion.output}`);

  const second = await pnpm(['run', 'db:seed']);

  if (second.code !== 0) fail('the second seed run failed');

  const comparison = await nodeScript('packages/database/scripts/assert-seeded-users.mjs', [
    '--snapshot',
    join(workspace, 'seed-2.json'),
  ]);

  if (comparison.code !== 0) {
    fail(`the seed is not idempotent:\n${comparison.output}`);
  }
}

async function verifyIntegrationSuite() {
  const suite = await pnpm(['run', 'test:integration']);

  if (suite.code !== 0) fail('the integration suite failed');

  // Every spec skips itself when PostgreSQL or Redis is unreachable, so this is
  // the assertion that turns "green" into "executed".
  const report = await nodeScript('scripts/assert-integration-report.mjs');

  if (report.code !== 0) fail(`the suite proved nothing:\n${report.output}`);
}

async function waitForLiveness(baseUrl, attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health/live`);

      if (response.ok) return;
    } catch {
      // Not listening yet. The loop is the retry.
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  fail(`the API never answered ${baseUrl}/api/v1/health/live after ${attempts}s`);
}

async function verifyHealthProbes() {
  const entry = join(repositoryRoot, 'services', 'api', 'dist', 'main.js');

  if (!existsSync(entry)) {
    fail('services/api/dist/main.js is missing. Run `pnpm run build` before this script.');
  }

  const port = process.env.API_PORT ?? '3000';
  const baseUrl = `http://127.0.0.1:${port}`;

  const api = spawn(process.execPath, [entry], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: process.env,
  });

  let output = '';

  api.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  api.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  const stop = () => {
    if (api.exitCode === null) api.kill();
  };

  try {
    await waitForLiveness(baseUrl);

    // Readiness is the criterion that needs infrastructure: it reports the
    // database and the cache individually, and answers 503 when either is down.
    const ready = await fetch(`${baseUrl}/api/v1/health/ready`);
    const body = await ready.json();

    if (!ready.ok) fail(`readiness answered ${ready.status}: ${JSON.stringify(body)}\n${output}`);

    // `HealthReadiness`, after the response envelope interceptor.
    const report = body?.data ?? body;
    const dependencies = report?.dependencies ?? {};

    for (const name of ['database', 'redis']) {
      if (dependencies[name]?.status !== 'up') {
        fail(
          `readiness reports ${name} as ${dependencies[name]?.status ?? 'missing'} ` +
            `with both endpoints reachable: ${JSON.stringify(dependencies)}`,
        );
      }
    }

    console.log(
      `      live 200, ready 200, ${Object.entries(dependencies)
        .map(([name, value]) => `${name}=${value.status} in ${value.latencyMs}ms`)
        .join(', ')}`,
    );
  } finally {
    stop();
  }
}

async function main() {
  const fromArgument = process.argv.indexOf('--from');
  const from = fromArgument === -1 ? 1 : Number(process.argv[fromArgument + 1] ?? Number.NaN);

  if (!Number.isInteger(from) || from < 1 || from > STEPS.length) {
    fail(`--from must be an integer between 1 and ${STEPS.length}`);
  }

  if (from > 1) {
    console.log(`Starting at step ${from}. Steps before it are NOT proved by this run:`);

    for (const descriptor of STEPS.slice(0, from - 1)) {
      console.log(`  - ${descriptor.name}`);
    }
  }

  const missing = REQUIRED_ENVIRONMENT.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    fail(`${missing.join(' and ')} must be set in the calling process. See docs/TESTING.MD.`);
  }

  const workspace = mkdtempSync(join(tmpdir(), 'deliveryuy-verify-'));

  console.log(`PostgreSQL: ${new URL(process.env.DATABASE_URL).host}`);
  console.log(`Redis:      ${process.env.REDIS_URL}`);

  // Printed because step 6 can fail on the budget alone: the probe opens its own
  // client, so a host where connecting is slow needs a larger
  // `HEALTH_CHECK_TIMEOUT_MS` than the default.
  console.log(
    `Health:     ${process.env.HEALTH_CHECK_TIMEOUT_MS ?? 'default (2000 ms)'} per dependency`,
  );

  try {
    if (from <= 1) {
      await step(1, 'prisma generate', async () => {
        const result = await pnpm(['run', 'db:generate']);

        if (result.code !== 0) fail('prisma generate failed');
      });
    }

    if (from <= 2) {
      await step(2, 'prisma migrate deploy', async () => {
        const result = await pnpm([
          '--filter',
          '@deliveryuy/database',
          'exec',
          'prisma',
          'migrate',
          'deploy',
        ]);

        if (result.code !== 0) fail('prisma migrate deploy failed');
      });
    }

    if (from <= 3) {
      await step(3, 'prisma migrate status', async () => {
        const result = await pnpm([
          '--filter',
          '@deliveryuy/database',
          'exec',
          'prisma',
          'migrate',
          'status',
        ]);

        if (result.code !== 0) {
          fail('prisma migrate status failed, which means a migration is left pending');
        }
      });
    }

    if (from <= 4) {
      await step(4, 'seed twice and assert', async () => {
        await verifySeedIsIdempotent(workspace);
      });
    }

    if (from <= 5) {
      await step(5, 'integration suite', async () => {
        await verifyIntegrationSuite();
      });
    }

    if (from <= 6) {
      await step(6, 'API health probes', async () => {
        await verifyHealthProbes();
      });
    }
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  console.log('\nAll infrastructure criteria in this script passed.');
  console.log('Still unproven by this run: the compose files bringing those servers up.');
}

await main();
