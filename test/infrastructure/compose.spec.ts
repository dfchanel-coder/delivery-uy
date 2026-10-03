/**
 * Contracts between the compose files, the example environment and the API
 * configuration.
 *
 * PHASE 01 exit criterion 3 asks for a `docker compose up` that provides
 * PostgreSQL and Redis with healthchecks. On a machine with no container
 * runtime that command cannot be run, so these specs prove the part that is
 * decidable without one: that the files are well formed, that every port and
 * credential they publish is the one the application is told to connect to, and
 * that every variable they interpolate is documented.
 *
 * What this file cannot prove, and what is therefore still open, is that the
 * referenced images start and become healthy. That needs a container runtime.
 */
import { describe, expect, it } from 'vitest';
import type { ComposeFile, ComposeService } from '../support/compose.js';
import {
  parseDotEnv,
  readRepositoryFile,
  readRepositoryYaml,
  repositoryRoot,
  resolveVariables,
  variableReferences,
} from '../support/repository-file.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEV = 'infrastructure/docker/docker-compose.dev.yml';
const TEST = 'infrastructure/docker/docker-compose.test.yml';
const DOCKER_ENV_EXAMPLE = 'infrastructure/docker/.env.docker.example';
const APP_ENV_EXAMPLE = '.env.example';

const devText = readRepositoryFile(DEV);
const testText = readRepositoryFile(TEST);
const dev = readRepositoryYaml<ComposeFile>(DEV);
const test = readRepositoryYaml<ComposeFile>(TEST);
const dockerEnvExample = parseDotEnv(readRepositoryFile(DOCKER_ENV_EXAMPLE));

/** Every service of both files, tagged with the file it came from. */
const allServices: Array<{
  readonly file: string;
  readonly name: string;
  readonly service: ComposeService;
}> = [
  ...Object.entries(dev.services).map(([name, service]) => ({ file: DEV, name, service })),
  ...Object.entries(test.services).map(([name, service]) => ({ file: TEST, name, service })),
];

/**
 * The host port a service publishes, with `${VAR:-default}` resolved.
 *
 * Compose's own shape is `HOST:CONTAINER`, optionally with a protocol. Only the
 * host side is interesting here: it is the port two stacks collide on. The value
 * from `.env.docker.example` wins over the inline default, exactly as Compose
 * resolves it, so a developer who changed the port is represented rather than
 * ignored.
 */
function publishedHostPort(spec: string, file: string): number {
  const resolved = resolveVariables(spec, dockerEnvExample).trim();
  const host = resolved.split(':')[0];

  expect(host, `${file} publishes an unresolvable port: ${spec}`).toMatch(/^\d+$/);

  return Number(host);
}

describe('compose files', () => {
  it('parses as structured documents with the services the project depends on', () => {
    expect(Object.keys(dev.services).sort()).toEqual(['postgres', 'redis']);
    expect(Object.keys(test.services).sort()).toEqual(['postgres', 'redis']);
  });

  it('pins an image for every service rather than building one', () => {
    // Nothing in the repository builds an image yet, so a `build:` key would be
    // a reference to a Dockerfile that does not exist.
    for (const { file, name, service } of allServices) {
      expect(service.image, `${file} service ${name} must pin an image`).toMatch(
        /^[a-z0-9.-]+(\/[a-z0-9._-]+)?:[A-Za-z0-9._-]+$/,
      );
      expect(
        service.build,
        `${file} service ${name} must not declare an unbuilt image`,
      ).toBeUndefined();
    }
  });

  it('gives every service a healthcheck that can actually succeed', () => {
    for (const { file, name, service } of allServices) {
      const healthcheck = service.healthcheck;

      expect(healthcheck, `${file} service ${name} has no healthcheck`).toBeDefined();
      expect(
        healthcheck?.test,
        `${file} service ${name} has an empty healthcheck command`,
      ).toBeTruthy();
      expect(healthcheck?.retries, `${file} service ${name} needs retries`).toBeGreaterThan(0);
      expect(healthcheck?.interval).toBeTruthy();
      expect(healthcheck?.timeout).toBeTruthy();
    }
  });

  it('never reuses a container name between the two stacks', () => {
    // `infra:up` and `infra:test` are independent, but both can be running at
    // once. A shared container_name makes the second `up` fail confusingly, or
    // worse, reuse the first stack's volume.
    const names = allServices.map(({ service }) => service.container_name);

    for (const name of names) {
      expect(
        name,
        'every service should pin a container_name so collisions are visible',
      ).toBeTruthy();
    }

    expect(new Set(names).size).toBe(names.length);
  });

  it('never publishes the same host port in both stacks', () => {
    // The two stacks are meant to coexist: a developer runs the dev stack while
    // the integration suite runs against the test stack.
    const ports = allServices.flatMap(({ file, service }) =>
      (service.ports ?? []).map((spec) => `${file}:${publishedHostPort(spec, file)}`),
    );
    const values = ports.map((entry) => entry.slice(entry.lastIndexOf(':') + 1));

    expect(new Set(values).size, `host port collision: ${ports.join(', ')}`).toBe(values.length);
  });

  it('keeps the test stack stateless so a run cannot inherit a previous one', () => {
    // The integration suite truncates between specs; a persisted test database
    // would make the result depend on what ran before it.
    expect(
      dev.services['postgres']?.tmpfs,
      'the dev stack should persist its data',
    ).toBeUndefined();
    expect(test.services['postgres']?.tmpfs).toContain('/var/lib/postgresql/data');
    expect(test.services['redis']?.command?.toString()).toContain('--appendonly');
  });

  it('mounts an init directory that exists, because an absent one is silent', () => {
    // Docker creates a missing bind-mount source as an empty directory, so a
    // typo in the path produces a healthy container that skipped its bootstrap.
    const mounts = dev.services['postgres']?.volumes ?? [];
    const initMount = mounts.find((mount) => mount.includes('docker-entrypoint-initdb.d'));

    expect(initMount, 'the dev postgres must run its bootstrap scripts').toBeTruthy();

    const source = (initMount as string).split(':')[0] as string;
    const resolved = join(
      repositoryRoot(),
      'infrastructure',
      'docker',
      source.replace(/^\.\//, ''),
    );

    expect(existsSync(resolved), `${source} is mounted but does not exist`).toBe(true);

    const scripts = readRepositoryFile('infrastructure/docker/postgres/init/00-bootstrap.sql');

    expect(scripts.length).toBeGreaterThan(0);
  });
});

describe('compose variables', () => {
  const references = [
    ...variableReferences(devText).map((reference) => ({ ...reference, file: DEV })),
    ...variableReferences(testText).map((reference) => ({ ...reference, file: TEST })),
  ];

  it('interpolates variables at all, so the checks below are not vacuous', () => {
    expect(references.length).toBeGreaterThan(0);
  });

  it('gives every variable without a default a documented declaration', () => {
    // A `${VAR}` with no fallback resolves to empty in Compose, which becomes a
    // port of `:` and a container that never starts. An operator needs a place
    // to set it, and the example file is that place.
    const undocumented = references
      .filter((reference) => reference.fallback === undefined)
      .filter((reference) => !dockerEnvExample.has(reference.name))
      .map((reference) => `${reference.file}: ${reference.name}`);

    expect(undocumented).toEqual([]);
  });

  it('documents every variable the compose files interpolate, defaulted or not', () => {
    // A default makes a reference safe, not discoverable. `TEST_POSTGRES_PORT`
    // defaulted to 5433 and appeared in no example file, so an operator whose
    // 5433 was taken had a knob nobody had written down.
    const undocumented = references
      .filter((reference) => !dockerEnvExample.has(reference.name))
      .map((reference) => `${reference.file}: ${reference.name}`);

    expect(undocumented).toEqual([]);
  });

  it('declares no variable the compose files ignore', () => {
    // The other direction: a documented variable nothing reads is an operator
    // editing a file that changes nothing.
    const referenced = new Set(references.map((reference) => reference.name));
    const unused = [...dockerEnvExample.keys()].filter((name) => !referenced.has(name));

    expect(unused).toEqual([]);
  });

  it('never ships a credential in the docker example', () => {
    // Development-only values, and the password is the one Compose must default
    // for a first-run experience. What must not appear is anything that looks
    // like a production secret.
    const password = dockerEnvExample.get('POSTGRES_PASSWORD');

    expect(password).toBeDefined();
    expect(password).not.toContain('CHANGE_ME');
    expect(password?.length ?? 0).toBeLessThan(32);
  });
});

describe('compose and application configuration agree', () => {
  const appEnv = parseDotEnv(readRepositoryFile(APP_ENV_EXAMPLE));

  it('publishes PostgreSQL where .env.example says the API will look', () => {
    // This is the check that catches the failure nobody sees: `pnpm infra:up`,
    // then the API cannot connect, because the example and the stack disagree.
    const url = new URL(appEnv.get('DATABASE_URL') as string);

    expect(url.protocol).toBe('postgresql:');
    expect(decodeURIComponent(url.username)).toBe(dockerEnvExample.get('POSTGRES_USER'));
    expect(decodeURIComponent(url.password)).toBe(dockerEnvExample.get('POSTGRES_PASSWORD'));
    expect(url.port).toBe(dockerEnvExample.get('POSTGRES_PORT'));
    expect(url.pathname.replace(/^\//, '')).toBe(dockerEnvExample.get('POSTGRES_DB'));
  });

  it('publishes Redis where .env.example says the API will look', () => {
    const url = new URL(appEnv.get('REDIS_URL') as string);

    expect(url.port).toBe(dockerEnvExample.get('REDIS_PORT'));
  });

  it('names both stacks differently, so one project name cannot overwrite the other', () => {
    expect(dev.name).toBeTruthy();
    expect(test.name).toBeTruthy();
    expect(dev.name).not.toBe(test.name);
  });
});
