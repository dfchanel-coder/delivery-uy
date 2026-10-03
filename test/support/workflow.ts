/**
 * The slice of the GitHub Actions workflow syntax this project uses.
 *
 * Declared rather than typed loosely so a rename fails to compile here instead
 * of turning an assertion into a check that always passes.
 */
export interface Workflow {
  readonly name?: string;
  readonly on?: unknown;
  readonly permissions?: Readonly<Record<string, string>> | string;
  readonly concurrency?: Readonly<Record<string, unknown>>;
  readonly jobs: Readonly<Record<string, Job>>;
}

export interface Job {
  readonly name?: string;
  readonly 'runs-on'?: string;
  readonly 'timeout-minutes'?: number;

  /** Containers GitHub starts before the steps run. */
  readonly services?: Readonly<Record<string, WorkflowService>>;

  readonly strategy?: Readonly<Record<string, unknown>>;

  readonly env?: Readonly<Record<string, string>>;

  readonly steps: readonly Step[];
}

export interface WorkflowService {
  readonly image: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly ports?: readonly string[];

  /** The `docker create` flags, including the healthcheck. */
  readonly options?: string;
}

export interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;

  readonly with?: Readonly<Record<string, unknown>>;

  readonly env?: Readonly<Record<string, string>>;

  readonly 'working-directory'?: string;

  readonly if?: string;

  readonly 'continue-on-error'?: boolean;
}
