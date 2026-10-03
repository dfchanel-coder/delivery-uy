/**
 * What `scripts/verify-infrastructure.mjs` is required to report.
 *
 * The script exists so a developer can prove the infrastructure-dependent exit
 * criteria without pushing. That only works if its output says what was actually
 * proven, and the failure mode is specific: a run against a convenient local
 * server reads exactly like a run against the reference version, because both
 * print a hostname and go green. Nobody can tell the difference afterwards, and
 * the document claiming they match becomes the only evidence.
 *
 * These contracts hold the reporting in place. They cannot check the numbers a
 * real run prints, so they assert the weaker thing that holds always: the script
 * asks the live servers, and compares them with pins read from the compose file
 * rather than from a copy inside itself.
 */
import { describe, expect, it } from 'vitest';
import type { ComposeFile } from '../support/compose.js';
import { readRepositoryFile, readRepositoryYaml } from '../support/repository-file.js';

const SCRIPT = 'scripts/verify-infrastructure.mjs';
const COMPOSE_TEST = 'infrastructure/docker/docker-compose.test.yml';

describe('the infrastructure verification script', () => {
  const source = readRepositoryFile(SCRIPT);
  const compose = readRepositoryYaml<ComposeFile>(COMPOSE_TEST);

  it('asks the live PostgreSQL which version it is', () => {
    // A version read back from the server. Anything copied from the compose file
    // would be a constant printed as if it were an observation.
    expect(source).toContain('SHOW server_version');
  });

  it('asks the live Redis which version it is', () => {
    // `INFO server` is the only way to learn this from the server itself; the
    // alternative, guessing from the configured URL, is the claim being checked.
    expect(source).toContain('INFO');
    expect(source).toContain('redis_version');
  });

  it('reads the reference images out of the compose file', () => {
    // Not hardcoded. A copy inside this script would keep comparing against a tag
    // nobody runs and would go on reporting a match after the pin moved, which is
    // the exact failure this reporting exists to prevent.
    expect(source).toContain(COMPOSE_TEST.split('/').at(-1));
    expect(source).toMatch(/services/);
  });

  it('does not hardcode an image reference anywhere', () => {
    const pinned = Object.values(compose.services).map((service) => service.image ?? '');

    expect(pinned.length).toBeGreaterThan(0);

    for (const image of pinned) {
      if (image === '') continue;

      expect(source, `${image} is duplicated inside the script`).not.toContain(image);
    }
  });

  it('says when the live version is not the pinned one', () => {
    // A mismatch has to be visible in the output. Without this the version is
    // printed and nobody is told what to conclude from it.
    expect(source).toContain('WARNING');
    expect(source).toMatch(/major/);
  });

  it('treats a version mismatch as a warning rather than a failure', () => {
    // The suites may well pass against a different major version, and failing
    // here would be a compatibility claim this script cannot establish. What it
    // must not do is pass silently either.
    const describe = /function describe\([\s\S]*?\n}/.exec(source)?.[0] ?? '';

    expect(describe).toContain('return');
    expect(describe).not.toContain('fail(');
  });

  it('still reports what the API printed when it never becomes live', () => {
    // A refused bind, an unset variable or a schema violation all appear in the
    // API's own log. Discarding it turns a thirty second wait into a message
    // saying nothing happened, which is the least useful possible report.
    expect(source).toMatch(/never answered[\s\S]*?describe\(\)/);
  });

  it('reads the PostgreSQL version after prisma generate, not before', () => {
    // Ordering, not style. Reading the version opens a Prisma client, and
    // `prisma generate` renames the query engine on disk; on Windows a loaded
    // engine cannot be renamed. Probing first therefore makes step 1 fail with
    // EPERM against a file this script was itself holding, which is the tool
    // breaking the criterion it exists to check.
    const generate = source.indexOf("step(1, 'prisma generate'");
    const probe = source.indexOf('await Promise.all([postgresVersion()');

    expect(generate).toBeGreaterThan(-1);
    expect(probe).toBeGreaterThan(-1);
    expect(probe, 'the version probe runs before prisma generate').toBeGreaterThan(generate);
  });

  it('names every environment variable it cannot do without', () => {
    // Checked rather than counted, because the failure being prevented is a run
    // that boots the API and dies for want of a variable nobody was told about.
    const required = /REQUIRED_ENVIRONMENT = \[([^\]]*)\]/.exec(source)?.[1] ?? '';

    for (const name of ['DATABASE_URL', 'REDIS_URL']) {
      expect(required, `${name} is not declared as required`).toContain(name);
    }
  });

  it('still admits the compose files themselves are unproven', () => {
    // The script cannot start containers, so the one criterion it can never
    // settle must stay said out loud. A run that printed "all criteria passed"
    // and stopped here would be overstating what was done (AGENTS.md section 5).
    expect(source).toContain('Still unproven');
    expect(source).toMatch(/compose/i);
  });
});
