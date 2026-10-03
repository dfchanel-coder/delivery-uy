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
 * The set of integration specs is discovered from the filesystem rather than
 * listed here. A hand-maintained list rots: it only fails when a listed file
 * disappears, so a spec added without being registered is silently unproven and
 * the list reads as coverage that does not exist. Comparing in both directions
 * against what is actually on disk makes adding coverage a normal change and
 * deleting it a failure.
 *
 * `MIN_EXECUTED` remains a floor, so removing assertions inside a spec that still
 * exists also fails.
 *
 * The two roots below must match `vitest.integration.config.ts`. That is not left
 * to memory: `test/infrastructure/integration-suite.spec.ts` asserts it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.resolve(repositoryRoot, process.argv[2] ?? 'integration-report.json');

const SPEC_ROOTS = ['packages', 'services'];
const SPEC_SUFFIX = '.integration.spec.ts';

const MIN_EXECUTED = 30;

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

/** Every `*.integration.spec.ts` committed in the workspace packages. */
function discoverSpecs() {
  const found = [];

  for (const root of SPEC_ROOTS) {
    let entries;

    try {
      entries = readdirSync(path.join(repositoryRoot, root), { recursive: true });
    } catch {
      // A missing root is a repository layout change, not a reason to pass.
      fail(`Could not read ${root}/ while looking for integration specs.`);
    }

    for (const entry of entries) {
      if (entry.endsWith(SPEC_SUFFIX) && !entry.includes('node_modules')) {
        found.push(path.basename(entry));
      }
    }
  }

  return found.sort();
}

let report;

try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  fail(`Could not read the integration report at ${reportPath}: ${error.message}`);
}

const results = report?.testResults ?? [];

/** Vitest records the file path in `name`; match on the basename. */
const ran = results.map((result) => path.basename(result.name ?? '')).sort();
const onDisk = discoverSpecs();

if (ran.length === 0) {
  fail(`The integration report contains no test files. Expected ${onDisk.length}.`);
}

const missing = onDisk.filter((spec) => !ran.includes(spec));

if (missing.length > 0) {
  fail(
    `Integration coverage is incomplete. Missing: ${missing.join(', ')}. ` +
      `Ran: ${ran.join(', ') || '(none)'}`,
  );
}

const unexpected = ran.filter((spec) => !onDisk.includes(spec));

if (unexpected.length > 0) {
  fail(
    `The report contains specs that are not in the repository: ${unexpected.join(', ')}. ` +
      `Either they were deleted without regenerating the report, or something outside the ` +
      `integration roots is being picked up.`,
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
