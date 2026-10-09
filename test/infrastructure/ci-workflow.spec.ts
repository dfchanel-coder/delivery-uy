/**
 * Contracts between the CI workflow and the repository it runs against.
 *
 * The `integration` job has never executed on GitHub: this repository has no
 * remote, so there is no runner and no log. A workflow that has never run is
 * unverified code, and the ways it breaks are quiet: a script that was renamed,
 * a variable the configuration schema rejects, an action pinned to a branch that
 * moved. Each of those produces a red job for a reason nobody anticipated, or a
 * job that silently stops proving anything.
 *
 * These specs read the workflow as data and hold it against the repository it
 * commands. They do not execute it. What remains unproven, stated plainly, is
 * that the runner's own environment behaves as these files assume.
 */
import { describe, expect, it } from 'vitest';
import { environmentKeys, environmentSchema } from '@deliveryuy/config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, Step, Workflow } from '../support/workflow.js';
import {
  readRepositoryFile,
  readRepositoryYaml,
  repositoryRoot,
} from '../support/repository-file.js';

const WORKFLOW = '.github/workflows/ci.yml';
const workflow = readRepositoryYaml<Workflow>(WORKFLOW);

/** Every step of every job, tagged so a failure names the job. */
const steps: Array<{ readonly job: string; readonly step: Step }> = Object.entries(
  workflow.jobs,
).flatMap(([job, definition]) => (definition.steps ?? []).map((step) => ({ job, step })));

/** Environment variables a job or a step declares, excluding GitHub built-ins. */
function declaredEnvironment(job: string, step: Step | undefined): Map<string, string> {
  const merged = new Map<string, string>([
    ...Object.entries(workflow.jobs[job]?.env ?? {}),
    ...Object.entries(step?.env ?? {}),
  ]);

  return merged;
}

/** Shell lines a step runs, one entry per non-empty, non-comment line. */
function shellLines(script: string): string[] {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Scripts a `pnpm run` or bare `pnpm` invocation names.
 *
 * Both forms appear in the workflow (`pnpm run build` and `pnpm exec vitest
 * run`), and only the first names a script that has to exist in the manifest.
 * The second is left alone: `pnpm exec` resolves a binary, not a script.
 */
function referencedScripts(script: string): string[] {
  const named: string[] = [];

  for (const line of shellLines(script)) {
    const run = /\bpnpm\s+run\s+([A-Za-z0-9:_-]+)/.exec(line);

    if (run?.[1] !== undefined) {
      named.push(run[1]);
    }
  }

  return named;
}

/** Files a step refers to as `node <path>` or `bash <path>`. */
function referencedFiles(script: string): string[] {
  const found: string[] = [];

  for (const line of shellLines(script)) {
    const match = /^\s*(?:node|bash|pwsh)\s+([^\s;&|]+)/.exec(line);

    if (match?.[1] !== undefined) {
      found.push(match[1].replace(/["']/g, ''));
    }
  }

  return found;
}

interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
}

const manifest = readRepositoryYaml<PackageManifest>('package.json');

describe('workflow structure', () => {
  it('parses with the four jobs the phases depend on', () => {
    // `verify` is the ordinary gate, `flutter` covers the mobile workspaces,
    // `compose` is the only place the compose files are actually started, and
    // `integration` covers the API against service containers.
    expect(Object.keys(workflow.jobs).sort()).toEqual([
      'compose',
      'flutter',
      'integration',
      'verify',
    ]);
  });

  it('bounds every job in time', () => {
    // A hung test suite on a shared runner costs the whole concurrency slot.
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job['runs-on'], `job ${name} has no runner`).toBeTruthy();
      expect(job['timeout-minutes'], `job ${name} has no timeout`).toBeGreaterThan(0);
    }
  });

  it('grants the workflow read-only access to the repository', () => {
    // Least privilege. A workflow that could push could publish a change that
    // never went through this file's own gate.
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('never marks a step as allowed to fail', () => {
    // `continue-on-error` is how a gate stops being a gate while still looking
    // green. There is no such step today; this keeps it that way deliberately.
    for (const { job, step } of steps) {
      expect(
        step['continue-on-error'],
        `job ${job} step ${step.name ?? step.uses}`,
      ).toBeUndefined();
    }
  });

  it('pins every third-party action to a released version', () => {
    // `@v4` tracks a tag; `@main` tracks a branch that can change what the
    // workflow means without any commit in this repository.
    for (const { job, step } of steps) {
      const uses = step.uses;

      if (uses === undefined || uses.startsWith('./')) {
        continue;
      }

      expect(uses, `job ${job} uses an action without a version`).toMatch(/@[a-z0-9][\w.-]*$/i);
      expect(uses, `job ${job} must not follow an action branch`).not.toMatch(
        /@(main|master|latest)$/i,
      );
    }
  });

  it('gives every step a name, so a failing run says what it was doing', () => {
    for (const { job, step } of steps) {
      // `actions/checkout` speaks for itself; anything running a script does not.
      if (step.run !== undefined) {
        expect(step.name, `job ${job} runs a script without a name`).toBeTruthy();
      }
    }
  });
});

describe('workflow commands the repository actually provides', () => {
  const scripts = manifest.scripts ?? {};

  it('invokes only scripts that exist in the root manifest', () => {
    // A renamed script makes the job fail at the step, which reads as an
    // infrastructure outage instead of a typo.
    const missing: string[] = [];

    for (const { job, step } of steps) {
      for (const name of referencedScripts(step.run ?? '')) {
        if (!(name in scripts)) {
          missing.push(`${job}: pnpm run ${name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('invokes only scripts that exist in the root manifest, through pnpm exec too', () => {
    // `pnpm test` and `pnpm build` are shorthands for `pnpm run`, and they are
    // the form a reader recognises. Same check, second spelling.
    const missing: string[] = [];

    for (const { job, step } of steps) {
      for (const line of shellLines(step.run ?? '')) {
        const shorthand = /^\s*pnpm\s+([A-Za-z0-9:_-]+)\s*$/.exec(line);

        if (shorthand?.[1] !== undefined && !(shorthand[1] in scripts)) {
          missing.push(`${job}: pnpm ${shorthand[1]}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('refers only to scripts and files that are committed', () => {
    const missing: string[] = [];

    for (const { job, step } of steps) {
      for (const file of referencedFiles(step.run ?? '')) {
        if (file.startsWith('$') || file.includes('$(')) {
          continue;
        }

        if (!existsSync(join(repositoryRoot(), file))) {
          missing.push(`${job}: ${file}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe('workflow environment matches the configuration schema', () => {
  /**
   * Variables the runner provides itself. Everything else a step sets is an
   * application variable and must be one the schema reads, or the API is being
   * configured with something it will ignore.
   */
  const RUNNER_PROVIDED = new Set([
    'CI',
    'GITHUB_ACTIONS',
    'GITHUB_REF',
    'GITHUB_SHA',
    'GITHUB_WORKSPACE',
    'RUNNER_TEMP',
    'RUNNER_OS',
  ]);

  /**
   * Variables that are real but belong to a process other than the API.
   *
   * The schema is the API's contract, not the repository's: the seed validates
   * its own variables and Next.js reads its own build flags. Allowlisting them
   * without naming the owner would make this check a rubber stamp, so each entry
   * declares the file that reads it and the next test proves that file still
   * does.
   */
  const OTHER_CONSUMERS: Readonly<Record<string, string>> = {
    NEXT_STANDALONE_OUTPUT: 'apps/admin/next.config.ts',
    SEED_ADMIN_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_ADMIN_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_MERCHANT_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_MERCHANT_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_DRIVER_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_DRIVER_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_CUSTOMER_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_CUSTOMER_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_SUPER_ADMIN_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_SUPER_ADMIN_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_SUPPORT_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_SUPPORT_PASSWORD: 'packages/database/prisma/seed.ts',
    SEED_FINANCE_EMAIL: 'packages/database/prisma/seed.ts',
    SEED_FINANCE_PASSWORD: 'packages/database/prisma/seed.ts',
  };

  it('sets no variable the API schema does not read', () => {
    const schemaKeys = new Set(environmentKeys);
    const unknown: string[] = [];

    for (const { job, step } of steps) {
      for (const name of declaredEnvironment(job, step).keys()) {
        if (RUNNER_PROVIDED.has(name) || name in OTHER_CONSUMERS) {
          continue;
        }

        if (!schemaKeys.has(name)) {
          unknown.push(`${job}: ${name}`);
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  it('allowlists only variables their named owner still reads', () => {
    // The allowlist is a claim about code that lives elsewhere, so it is checked
    // rather than trusted: a seed that stopped reading `SEED_DRIVER_PASSWORD`
    // would otherwise keep an entry here that documents nothing.
    const orphaned: string[] = [];

    for (const [name, owner] of Object.entries(OTHER_CONSUMERS)) {
      if (!readRepositoryFile(owner).includes(name)) {
        orphaned.push(`${name} is allowlisted for ${owner}, which no longer reads it`);
      }
    }

    expect(orphaned).toEqual([]);
  });

  it('leaves the API process lifecycle to the verification script', () => {
    // The workflow used to start the API with `&`, capture `$!` and `kill` it,
    // which is bash-only and leaks a bound port when the loop times out. The
    // script owns the lifecycle instead, so a step that declares a process id
    // is the previous design coming back.
    for (const { job, step } of steps) {
      const declared = declaredEnvironment(job, step);

      expect(declared.has('API_PID'), `job ${job} must not declare a process id in env`).toBe(
        false,
      );
    }

    expect(readRepositoryFile(WORKFLOW)).not.toContain('API_PID');
  });

  it('proves the script both starts and stops the API it boots', () => {
    // A probe that starts the process and never stops it leaves the runner
    // holding the port for the next job, and the failure appears somewhere
    // unrelated.
    const script = readRepositoryFile('scripts/verify-infrastructure.mjs');

    expect(script).toContain('spawn(process.execPath');
    expect(script).toContain('.kill()');
  });

  it('provides every required secret the schema has no default for', () => {
    // The API refuses to start without these, so a step that boots it must set
    // them, at job or step level. Asserting the refusal here is what keeps the
    // list from drifting when the schema gains a new required key.
    const requiredWithoutDefault = [
      'DATABASE_URL',
      'REDIS_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ];
    const missing: string[] = [];

    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (!(step.run ?? '').includes('dist/main.js')) {
          continue;
        }

        const available = new Set([
          ...declaredEnvironment(name, undefined).keys(),
          ...declaredEnvironment(name, step).keys(),
        ]);

        for (const key of requiredWithoutDefault) {
          if (!available.has(key)) {
            missing.push(`${name}: ${key}`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });

  it('uses secrets the schema would accept at runtime', () => {
    // The API validates its own environment and refuses to start on a bad
    // secret. Rather than restate those rules here, the workflow's own values
    // are run through the schema: if a secret is too short, equal to the other,
    // or still the `CHANGE_ME` placeholder, this fails with the schema's own
    // message instead of a red log line thirty seconds into a job.
    const collected = new Map<string, string>();

    for (const { job, step } of steps) {
      for (const [name, value] of declaredEnvironment(job, step)) {
        // A later job overriding a secret is fine; the last value wins, exactly
        // as it would at runtime.
        collected.set(name, value);
      }
    }

    const candidate = {
      NODE_ENV: collected.get('NODE_ENV') ?? 'test',
      APP_ENV: collected.get('APP_ENV') ?? 'test',
      SERVICE_NAME: 'api',
      DATABASE_URL: collected.get('DATABASE_URL') ?? '',
      REDIS_URL: collected.get('REDIS_URL') ?? '',
      JWT_ACCESS_SECRET: collected.get('JWT_ACCESS_SECRET') ?? '',
      JWT_REFRESH_SECRET: collected.get('JWT_REFRESH_SECRET') ?? '',
    };

    const parsed = environmentSchema.safeParse(candidate);

    expect(
      parsed.success
        ? []
        : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    ).toEqual([]);
  });
});

describe('the integration job', () => {
  const integration = workflow.jobs['integration'] as Job | undefined;

  it('starts PostgreSQL and Redis as real service containers', () => {
    // Service containers rather than `docker compose up`: the job needs two
    // reachable endpoints, not the development stack with its volumes and its
    // init scripts.
    expect(Object.keys(integration?.services ?? {}).sort()).toEqual(['postgres', 'redis']);
    expect(integration?.services?.['postgres']?.image).toMatch(/^postgres:16/);
    expect(integration?.services?.['redis']?.image).toMatch(/^redis:7/);
  });

  it('waits for both services to report healthy before running a step', () => {
    // Without `--health-cmd` GitHub starts the container and the first step
    // races a server that is still booting.
    for (const [name, service] of Object.entries(integration?.services ?? {})) {
      expect(service.options, `service ${name} has no healthcheck options`).toContain(
        '--health-cmd',
      );
      expect(service.options).toContain('--health-retries');
    }
  });

  it('asserts the integration suite executed rather than skipped', () => {
    // Every spec skips itself when its dependency is missing, so a green run
    // alone proves nothing. Without this assertion the job could pass having
    // executed three tests. The call lives in the shared script now, so the
    // assertion follows it there.
    const script = readRepositoryFile('scripts/verify-infrastructure.mjs');

    expect(script).toContain('scripts/assert-integration-report.mjs');
  });

  it('runs the shared infrastructure verification, not a private copy of it', () => {
    // The steps must be the ones a developer can run locally, or "it works on
    // CI" and "it works on my machine" are verified by different code.
    const shared = steps.some(({ step }) => (step.run ?? '').includes('verify-infrastructure.mjs'));

    expect(shared).toBe(true);
  });

  it('never carries a credential that looks like a real one', () => {
    // The seed credentials are declared here rather than defaulted inside the
    // seed, so a committed default password would be a committed backdoor. What
    // they must be is unmistakably CI-scoped.
    const passwords = steps.flatMap(({ step }) =>
      Object.entries(step.env ?? {})
        .filter(([name]) => name.endsWith('PASSWORD'))
        .map(([, value]) => value),
    );

    expect(passwords.length).toBeGreaterThan(0);

    for (const password of passwords) {
      expect(password).toContain('ci-only');
    }
  });

  it('refers to no GitHub secret, so the job is reproducible from the file alone', () => {
    const text = readRepositoryFile(WORKFLOW);

    expect(text).not.toContain('${{ secrets.');
  });
});

/**
 * The compose job is the only place PHASE 01 exit criterion 3 is proven.
 *
 * Until it existed, nothing started these files anywhere: `docker compose
 * config --quiet` parses a document, and the `integration` job takes its servers
 * from a `services:` block in the workflow instead. A criterion that reads
 * "the images start and become healthy" and is decided by a YAML parse is not
 * met, and the way it fails is quiet - it looks met.
 *
 * So the contracts below are mostly about the job still doing what it was added
 * for. Each of them fails if someone reduces the boot back to a validation.
 */
describe('the compose job', () => {
  const job = workflow.jobs['compose'];
  const jobSteps = job?.steps ?? [];
  const runs = jobSteps.map((step) => step.run ?? '');

  interface ComposeFile {
    readonly services?: Readonly<Record<string, { readonly ports?: readonly (string | number)[] }>>;
  }

  /**
   * The host port a compose service publishes, taken from the file rather than
   * restated. Reading it out of the interpolation means a port renamed in the
   * compose file moves this expectation with it, instead of leaving a hardcoded
   * number here to drift against the thing it describes.
   *
   * Both spellings are handled because the file uses both: `'${POSTGRES_PORT:-5432}:5432'`
   * and a bare `'5432:5432'`. Splitting on `:` does not work for the first, since
   * the interpolation itself contains a colon.
   */
  function publishedPort(service: string): number {
    const compose = readRepositoryYaml<ComposeFile>('infrastructure/docker/docker-compose.dev.yml');
    const mapping = compose.services?.[service]?.ports?.[0];

    if (typeof mapping !== 'string') {
      throw new Error(`the development compose file publishes no port for ${service}`);
    }

    const interpolated = /:-(\d+)\}/.exec(mapping)?.[1];
    const plain = /^(\d+):/.exec(mapping)?.[1];

    return Number(interpolated ?? plain);
  }

  it('exists as a job of its own', () => {
    // Not a step inside `integration`. Criterion 3 is a separate criterion, and
    // folding it into another job would mean a red run for two unrelated reasons.
    expect(job).toBeDefined();
    expect(job?.['runs-on']).toBeTruthy();
    expect(job?.['timeout-minutes']).toBeGreaterThan(0);
  });

  it('starts every compose file rather than only parsing it', () => {
    // The assertion the whole job exists for. `config --quiet` was the previous
    // state of this repository: a green check that proved a file parses.
    const started = runs.filter((run) => /docker compose\b.*\bup\b/.test(run));

    expect(started.length).toBeGreaterThanOrEqual(2);

    for (const composeFile of ['docker-compose.dev.yml', 'docker-compose.test.yml']) {
      expect(
        started.some((run) => run.includes(composeFile)),
        `nothing starts ${composeFile}`,
      ).toBe(true);
    }
  });

  it('waits for health on every start instead of racing a booting server', () => {
    // `up -d` without `--wait` returns as soon as the container exists, so the
    // next step talks to a server that has not finished starting - which shows up
    // as a flaky connection error in whatever ran next, not as a health problem.
    //
    // Matched with a boundary rather than a substring, because `--wait-timeout`
    // contains `--wait`: a plain `toContain` here is satisfied by the timeout
    // option alone and would pass on exactly the command it exists to reject.
    for (const run of runs.filter((candidate) => /docker compose\b.*\bup\b/.test(candidate))) {
      expect(run, `an up without --wait: ${run.trim()}`).toMatch(/(?:^|\s)--wait(?:\s|$)/m);
    }
  });

  it('validates both definitions before starting anything', () => {
    const validateIndex = runs.findIndex((run) => run.includes('config --quiet'));
    const firstUpIndex = runs.findIndex((run) => /docker compose\b.*\bup\b/.test(run));

    expect(validateIndex).toBeGreaterThanOrEqual(0);
    expect(firstUpIndex).toBeGreaterThan(validateIndex);

    expect(runs[validateIndex]).toContain('docker-compose.dev.yml');
    expect(runs[validateIndex]).toContain('docker-compose.test.yml');
  });

  it('stops every stack it starts, including after a failure', () => {
    // Without `if: always()` a failed verification leaves containers holding
    // their published ports, and the runner is torn down before anyone reads
    // which of them was at fault.
    const downs = jobSteps.filter((step) => /docker compose\b.*\bdown\b/.test(step.run ?? ''));

    expect(downs.length).toBeGreaterThanOrEqual(2);

    for (const step of downs) {
      // GitHub spells this `always()`, and a YAML parser hands the expression
      // back verbatim, so both spellings have to be accepted here rather than
      // asserting the one this file happens to use.
      expect(step.if, `a teardown that skips on failure: ${step.name ?? step.run}`).toMatch(
        /^always\b/,
      );
    }
  });

  it('proves the application works against the stack, not only that it started', () => {
    // `--wait` proves the containers report healthy. It does not prove the
    // application can use them, which is the half that fails for real: a port
    // published to the wrong interface, a database name the seed does not match,
    // a volume that swallows the data directory.
    const shared = runs.some((run) => run.includes('verify-infrastructure.mjs'));

    expect(shared).toBe(true);
  });

  it('points at the ports the development compose file publishes', () => {
    // The failure this prevents is a slow one to read: `DATABASE_URL` naming a
    // port nothing listens on, and a log full of connection refused that reads
    // like a broken image rather than a stale number in this file.
    const env = job?.env ?? {};

    expect(env['DATABASE_URL']).toContain(`:${publishedPort('postgres')}/`);
    expect(env['REDIS_URL']).toContain(`:${publishedPort('redis')}`);
  });

  it('leaves the published ports to the compose file', () => {
    // Setting `POSTGRES_PORT` here would publish the container somewhere the
    // `DATABASE_URL` above does not name, and the correspondence asserted above
    // would become a coincidence rather than a fact.
    const env = job?.env ?? {};

    expect(env).not.toHaveProperty('POSTGRES_PORT');
    expect(env).not.toHaveProperty('REDIS_PORT');
  });

  it('gives the health probe a budget a just-started container can meet', () => {
    // The default is 2000 ms per dependency, and a healthy PostgreSQL has been
    // observed to answer the first probe in 2187 ms on a slow host. On a runner
    // the first connection is colder still, and paying a red job for the budget
    // would waste the only run this repository gets.
    const budget = (job?.env ?? {})['HEALTH_CHECK_TIMEOUT_MS'];

    expect(budget, 'the compose job leaves the health budget at its default').toBeDefined();
    expect(Number(budget)).toBeGreaterThan(2000);
  });
});
