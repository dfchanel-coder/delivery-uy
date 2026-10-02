/**
 * Duration parsing for configuration values such as `15m` or `30d`.
 *
 * Lives here rather than in a service because both the auth and the dispatch
 * code need it, and a hand-written `parseInt('30d')` mistake would silently turn
 * a 30 day session into 30 milliseconds.
 */

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

const MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
});

/** Parses a duration into milliseconds. Throws on anything unexpected. */
export function parseDurationToMs(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());

  if (match === null) {
    throw new TypeError(`Unsupported duration "${value}". Use forms like 500ms, 15m, 12h, 30d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? '';
  const multiplier = MULTIPLIERS[unit];

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new RangeError(`Duration "${value}" must be a positive whole number.`);
  }

  return amount * (multiplier ?? 1);
}

/** Whole seconds, for wire contracts that expose a lifetime (`expiresIn`). */
export function parseDurationToSeconds(value: string): number {
  return Math.floor(parseDurationToMs(value) / 1000);
}
