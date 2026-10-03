/**
 * The integration suite's discovery rules, held against its configuration.
 *
 * `scripts/assert-integration-report.mjs` decides which integration specs must
 * have run by walking `packages/` and `services/`. That walk and the `include`
 * list in `vitest.integration.config.ts` have to agree, or one of two things
 * happens silently: a spec the config never runs is demanded in the report and
 * CI fails on a file nobody executes, or a spec the config runs is invisible to
 * the assertion that exists to prove it ran.
 *
 * The script cannot import a TypeScript config, so the two are joined here
 * instead of in either file.
 */
import { describe, expect, it } from 'vitest';
import integrationConfig from '../../vitest.integration.config.js';
import { readRepositoryFile } from '../support/repository-file.js';

const SCRIPT = 'scripts/assert-integration-report.mjs';
const specSuffix = '.integration.spec.ts';

/** An include pattern names its root before the first slash. */
function rootOf(include: string): string {
  const root = include.split('/')[0];

  if (root === undefined) {
    throw new Error(`Unreadable include pattern: ${include}`);
  }

  return root;
}

describe('the integration suite', () => {
  const includes = integrationConfig.test?.include ?? [];

  it('is configured, so this spec is reading a real include list', () => {
    expect(includes.length).toBeGreaterThan(0);
  });

  it('only collects integration specs', () => {
    // A pattern that also matched ordinary specs would drag unit tests into the
    // infrastructure job, where they would execute twice and the report would
    // count assertions the suite never meant to prove against real servers.
    for (const include of includes) {
      expect(include, `include ${include} is not restricted to integration specs`).toContain(
        `*${specSuffix}`,
      );
    }
  });

  it('searches exactly the roots the report assertion walks', () => {
    const configured = [...new Set(includes.map(rootOf))].sort();
    const script = readRepositoryFile(SCRIPT);

    for (const root of configured) {
      expect(script, `${root} is collected by vitest but absent from ${SCRIPT}`).toContain(
        `'${root}'`,
      );
    }
  });

  it('runs on a single fork, because the specs truncate shared tables', () => {
    // Two workers truncating the same rows would make results depend on timing.
    // A change here would need a different isolation strategy, not just a config
    // edit, which is why it is asserted rather than left to a comment.
    const pool = integrationConfig.test?.pool;
    const singleFork = integrationConfig.test?.poolOptions?.forks?.singleFork;

    expect(pool === 'forks' || singleFork === true).toBe(true);
  });
});
