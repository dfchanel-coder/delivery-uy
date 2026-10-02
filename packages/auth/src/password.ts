import { randomUUID } from 'node:crypto';
import { hash, verify, type Options } from '@node-rs/argon2';

/**
 * Password hashing with Argon2id (SECURITY.md "Password Storage").
 *
 * Argon2id is the only algorithm accepted here. `bcrypt`, `scrypt` and MD5/SHA
 * hashes are rejected on sight: if a row somehow contains one, login must fail
 * closed and force a rehash rather than silently weakening the guarantee.
 *
 * Parameters are never hardcoded in business logic. They arrive from
 * `packages/config` (`PASSWORD_ARGON2_MEMORY_KIB`,
 * `PASSWORD_ARGON2_ITERATIONS`), so raising the cost is a configuration change
 * (AGENTS.md section 52).
 */

export interface Argon2Parameters {
  /** KiB of memory per hash. Default matches SECURITY.md (64 MiB). */
  readonly memoryKib: number;
  /** Number of passes over memory. */
  readonly iterations: number;
  /** Lanes. 1 keeps the cost predictable on shared CI runners. */
  readonly parallelism: number;
}

/** Values documented in SECURITY.md "Password and Token Parameters". */
export const DEFAULT_ARGON2_PARAMETERS: Argon2Parameters = Object.freeze({
  memoryKib: 65536,
  iterations: 3,
  parallelism: 1,
});

/**
 * Upper bound on accepted input.
 *
 * Argon2 hashes the whole input, so an unbounded password turns login into a
 * memory-exhaustion vector. 512 characters is far above any human password and
 * far below the point where hashing becomes expensive.
 */
export const MAX_PASSWORD_LENGTH = 512;

/** Cheap parameters for tests. Never used in production. */
export const TEST_ARGON2_PARAMETERS: Argon2Parameters = Object.freeze({
  memoryKib: 8192,
  iterations: 1,
  parallelism: 1,
});

/** PHC string prefix produced by Argon2id version 0x13 with our parameter layout. */
const ARGON2ID_PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * Algorithm and version identifiers.
 *
 * `@node-rs/argon2` declares `Algorithm` and `Version` as ambient const enums,
 * which cannot be read under `isolatedModules`, so the numeric values are used
 * directly: variant 2 is Argon2id (0 = d, 1 = i), and version 1 is the library's
 * encoding of 0x13, printed as `v=19` in the PHC string. A wrong value would
 * produce a different prefix and fail the assertions in `password.spec.ts`
 * rather than silently hashing with a weaker algorithm.
 */
const ARGON2ID_ALGORITHM = 2;
const ARGON2_VERSION_0X13 = 1;

const FIXED_OPTIONS = {
  algorithm: ARGON2ID_ALGORITHM,
  version: ARGON2_VERSION_0X13,
} satisfies Partial<Options>;

function assertParameters(parameters: Argon2Parameters): void {
  const { memoryKib, iterations, parallelism } = parameters;

  if (!Number.isInteger(memoryKib) || memoryKib < 8192 || memoryKib > 1048576) {
    throw new RangeError('argon2 memoryKib must be an integer between 8192 and 1048576');
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 20) {
    throw new RangeError('argon2 iterations must be an integer between 1 and 20');
  }
  if (!Number.isInteger(parallelism) || parallelism < 1 || parallelism > 16) {
    throw new RangeError('argon2 parallelism must be an integer between 1 and 16');
  }
}

function assertHashablePassword(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('password must be a non-empty string');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`password must not exceed ${MAX_PASSWORD_LENGTH} characters`);
  }
}

/**
 * Hashes a password with Argon2id.
 *
 * The salt is generated per call by the library, so two identical passwords
 * never share a hash.
 */
export async function hashPassword(
  password: string,
  parameters: Argon2Parameters = DEFAULT_ARGON2_PARAMETERS,
): Promise<string> {
  assertParameters(parameters);
  assertHashablePassword(password);

  return hash(password, {
    ...FIXED_OPTIONS,
    memoryCost: parameters.memoryKib,
    timeCost: parameters.iterations,
    parallelism: parameters.parallelism,
  });
}

/** True only for an Argon2id PHC string; anything else fails closed. */
export function isArgon2idHash(stored: string): boolean {
  return typeof stored === 'string' && ARGON2ID_PHC_PATTERN.test(stored);
}

/**
 * Verifies a password against a stored hash.
 *
 * Never throws: a malformed or legacy hash is a failed verification, not a
 * server error, so a corrupted row cannot turn every login into a 500.
 */
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  if (!isArgon2idHash(stored)) return false;
  if (typeof password !== 'string' || password.length === 0) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

/**
 * Verifies a password while keeping the cost of both branches identical.
 *
 * Login must not reveal whether an account exists. When `stored` is null (no
 * such user) the work still happens, against a throwaway hash created once per
 * parameter set, so the response time of "unknown email" matches the response
 * time of "wrong password".
 *
 * The dummy hash is memoised on purpose: generating it costs one Argon2 run.
 */
const dummyHashes = new Map<string, Promise<string>>();

function dummyHashFor(parameters: Argon2Parameters): Promise<string> {
  const key = `${parameters.memoryKib}:${parameters.iterations}:${parameters.parallelism}`;
  const cached = dummyHashes.get(key);

  if (cached !== undefined) return cached;

  // A random secret: it grants nothing even if it ever leaked, it only has to
  // make the verification expensive.
  const secret = `${randomUUID()}-${randomUUID()}`;
  const pending = hashPassword(secret, parameters);
  dummyHashes.set(key, pending);

  return pending;
}

/**
 * Returns whether the password matches, always performing exactly one Argon2
 * verification so timing does not disclose account existence.
 */
export async function verifyPasswordOrDummy(
  stored: string | null,
  password: string,
  parameters: Argon2Parameters = DEFAULT_ARGON2_PARAMETERS,
): Promise<boolean> {
  if (stored === null || stored === undefined) {
    await verifyPassword(await dummyHashFor(parameters), password);
    return false;
  }

  return verifyPassword(stored, password);
}

/**
 * Reports whether a stored hash must be replaced after a successful login.
 *
 * A hash with weaker parameters than the current configuration is still valid
 * for verification but must be upgraded while the plaintext password is
 * available, which only happens during login.
 */
export function passwordNeedsRehash(
  stored: string,
  parameters: Argon2Parameters = DEFAULT_ARGON2_PARAMETERS,
): boolean {
  const match = ARGON2ID_PHC_PATTERN.exec(stored);

  if (match === null) return true;

  const [, memory, iterations, parallelism] = match;
  return (
    memory !== String(parameters.memoryKib) ||
    iterations !== String(parameters.iterations) ||
    parallelism !== String(parameters.parallelism)
  );
}

export interface PasswordPolicy {
  readonly minLength: number;
  /** Defaults to {@link MAX_PASSWORD_LENGTH}. */
  readonly maxLength?: number;
}

/**
 * Checks a password against the configured policy.
 *
 * Returns the list of human-readable problems so the API can answer with
 * actionable `details` instead of a boolean. An empty list means acceptable.
 * Composition rules (uppercase, digits, symbols) are deliberately absent: length
 * plus Argon2id is what the platform enforces, and inventing stricter,
 * unstated rules only pushes users towards predictable substitutions.
 */
export function checkPasswordPolicy(password: string, policy: PasswordPolicy): readonly string[] {
  const problems: string[] = [];
  const maxLength = policy.maxLength ?? MAX_PASSWORD_LENGTH;

  if (typeof password !== 'string') {
    return ['password must be a string'];
  }
  if (password.length < policy.minLength) {
    problems.push(`password must be at least ${policy.minLength} characters`);
  }
  if (password.length > maxLength) {
    problems.push(`password must not exceed ${maxLength} characters`);
  }

  return problems;
}
