/**
 * The slice of the Compose Specification these files use.
 *
 * Declared rather than typed as `unknown` and cast at every use: a spec that
 * asserts on structure should fail to compile when the shape it depends on is
 * renamed, instead of reading `undefined` and quietly passing.
 *
 * This is not the full specification. It is the subset the project depends on,
 * and the fields deliberately left out are the ones nothing asserts about.
 */
export interface ComposeFile {
  /** Project name, which is what `docker compose` prefixes container names with. */
  readonly name?: string;

  readonly services: Readonly<Record<string, ComposeService>>;

  readonly volumes?: Readonly<Record<string, unknown>>;
}

export interface ComposeService {
  readonly image?: string;
  readonly build?: unknown;

  /** Overrides the container name Compose would derive. */
  readonly container_name?: string;

  readonly environment?: Readonly<Record<string, string>>;

  /** `HOST:CONTAINER` mappings. */
  readonly ports?: readonly string[];

  readonly volumes?: readonly string[];

  /** Directories mounted over a container path; never persisted. */
  readonly tmpfs?: readonly string[];

  readonly healthcheck?: ComposeHealthcheck;

  readonly depends_on?: Readonly<Record<string, unknown>>;

  readonly command?: readonly string[] | string;

  readonly restart?: string;
}

export interface ComposeHealthcheck {
  /** `CMD`, `CMD-SHELL` or `NONE`, followed by the command. */
  readonly test: readonly string[] | string;

  readonly interval?: string;

  readonly timeout?: string;

  readonly retries?: number;

  readonly start_period?: string;
}
