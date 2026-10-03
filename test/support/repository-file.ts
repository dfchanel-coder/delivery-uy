/**
 * Reads repository files from the specs that check the repository itself.
 *
 * The compose files and the CI workflow are the two places where the project's
 * promises are written down and never executed by `pnpm test`. A drift between
 * them and the code only surfaces when someone runs them, which is exactly the
 * failure mode these specs exist to prevent.
 *
 * Paths are resolved by walking up from the working directory rather than
 * relative to this module, because vitest may be started from the repository
 * root or from inside a package.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const MARKER = 'package.json';

/** Finds the repository root by looking for the workspace manifest upwards. */
export function repositoryRoot(): string {
  let directory = process.cwd();

  for (;;) {
    if (existsSync(join(directory, MARKER)) && existsSync(join(directory, '.github'))) {
      return directory;
    }

    const parent = dirname(directory);

    if (parent === directory) {
      throw new Error(`Could not find ${MARKER} above ${process.cwd()}`);
    }

    directory = parent;
  }
}

/**
 * Reads a repository file as text.
 *
 * Throws when the file is absent rather than returning an empty string: a
 * missing `.env.example` must fail a spec, not silently satisfy a check about
 * its contents.
 */
export function readRepositoryFile(relativePath: string): string {
  const target = join(repositoryRoot(), relativePath);

  if (!existsSync(target)) {
    throw new Error(`Missing repository file: ${relativePath}`);
  }

  return readFileSync(target, 'utf8');
}

/**
 * Parses a repository YAML file.
 *
 * The document is returned as data rather than as text so a spec can assert on
 * structure. A regular expression over YAML would pass on a comment and fail on
 * a reformat, which is the kind of test that looks green and proves nothing.
 */
export function readRepositoryYaml<T>(relativePath: string): T {
  return parseYaml(readRepositoryFile(relativePath)) as T;
}

/**
 * Parses a `.env`-style file into a map.
 *
 * Comment lines, blank lines and an `export ` prefix are ignored, and the first
 * `=` splits, so `KEY=value with = inside` survives. A line without `=` is
 * skipped rather than producing a key of `undefined`.
 */
export function parseDotEnv(contents: string): Map<string, string> {
  const entries = new Map<string, string>();

  for (const raw of contents.split('\n')) {
    const line = raw.trim();

    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');

    if (separator < 0) {
      continue;
    }

    const name = (line.startsWith('export ') ? line.slice(7) : line).slice(0, separator).trim();

    entries.set(name, line.slice(separator + 1).trim());
  }

  return entries;
}

/** A `${VAR}` or `${VAR:-default}` occurrence inside a compose file. */
export interface VariableReference {
  /** Variable name, without the `$`, braces or default. */
  readonly name: string;

  /** The literal default after `:-`, or undefined when there is none. */
  readonly fallback: string | undefined;
}

const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Finds every `${VAR}` reference in a compose file.
 *
 * Both compose files publish their ports through these references, so they are
 * the seam between what an operator can change and what the application expects
 * to connect to. A variable with no default and no documented declaration is a
 * port that silently takes whatever the shell happens to hold.
 */
export function variableReferences(contents: string): VariableReference[] {
  const found: VariableReference[] = [];

  for (const match of contents.matchAll(VARIABLE_PATTERN)) {
    found.push({ name: match[1] as string, fallback: match[2] });
  }

  return found;
}

/**
 * Substitutes every `${VAR}` and `${VAR:-default}` in a string.
 *
 * Mirrors Compose's own rule: a default applies when the variable is unset *or
 * empty*, and an unresolvable reference without a default becomes an empty
 * string, which is what `docker compose config` does before it fails.
 */
export function resolveVariables(contents: string, environment: Map<string, string>): string {
  return contents.replace(VARIABLE_PATTERN, (_whole, name: string, fallback?: string) => {
    const value = environment.get(name);

    if (value !== undefined && value !== '') {
      return value;
    }

    return fallback ?? '';
  });
}
