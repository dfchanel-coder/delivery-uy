/**
 * Fails the integration job when the integration specs did not actually run.
 *
 * Each integration spec skips itself when PostgreSQL or Redis is unreachable
 * (see `services/api/src/testing/infrastructure.ts`). That keeps `pnpm test`
 * usable on a machine without Docker, but it also means a green vitest exit
 * code can mean "everything was skipped". This script reads the JSON report the
 * integration config writes and compares it with the expectations below, so a
 * skipped suite fails CI instead of passing quietly.
 *
 * `EXPECTED_FILES` is the set of adapters that must be proven against real
 * infrastructure. `MIN_EXECUTED` is a floor, not an exact count: adding a test
 * must not require editing this file, but removing coverage without editing it
 * must fail.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const reportPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  process.argv[2] ?? 'integration-report.json',
);

const EXPECTED_FILES = [
  'prisma-password-reset-token.repository.integration.spec.ts',
  'prisma-risk-event.repository.integration.spec.ts',
  'prisma-session.repository.integration.spec.ts',
  'prisma-user.repository.integration.spec.ts',
  'redis-rate-limiter.integration.spec.ts',
];

const MIN_EXECUTED = 30;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

let report;

try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`Could not read the integration report at ${reportPath}: ${error.message}`);
}

const results = report?.testResults ?? [];

if (results.length === 0) {
  fail(`The integration report contains no test files. Expected ${EXPECTED_FILES.length}.`);
}

/** Vitest records the file path in `name`; match on the basename. */
const names = results.map((result) => path.basename(result.name ?? ''));

const missing = EXPECTED_FILES.filter((expected) => !names.includes(expected));

if (missing.length > 0) {
  fail(
    `Integration coverage is incomplete. Missing: ${missing.join(', ')}. ` +
      `Ran: ${names.join(', ') || '(none)'}`,
  );
}

/**
 * Vitest's JSON reporter writes `skipped` for `it.skip` / `ctx.skip()`, and
 * `pending` / `todo` for the other ways a test can be deferred. All of them mean
 * the assertions never ran, so all of them are counted together.
 */
const NOT_EXECUTED = new Set(['skipped', 'pending', 'todo']);

const assertions = results.flatMap((result) => result.assertionResults ?? []);
const executed = assertions.filter((assertion) => !NOT_EXECUTED.has(assertion.status)).length;
const skipped = assertions.filter((assertion) => NOT_EXECUTED.has(assertion.status)).length;

if (skipped > 0) {
  const offenders = results
    .filter((result) => (result.assertionResults ?? []).some((a) => NOT_EXECUTED.has(a.status)))
    .map((result) => path.basename(result.name ?? ''));

  fail(
    `${skipped} of ${assertions.length} integration tests were skipped, in: ${offenders.join(', ')}. ` +
      `Every spec must run against real PostgreSQL and Redis in this job; a skip means the ` +
      `dependency was unreachable.`,
  );
}

if (executed < MIN_EXECUTED) {
  fail(
    `Only ${executed} integration tests executed; at least ${MIN_EXECUTED} are expected. ` +
      `Coverage may have been removed without updating EXPECTED_FILES.`,
  );
}

console.log(
  `Integration report OK: ${executed} tests executed across ${results.length} files, 0 skipped.`,
);
