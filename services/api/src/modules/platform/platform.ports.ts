/**
 * Platform configuration ports (docs/MODULE_BOUNDARIES.md: `platform` owns
 * `feature_flags` and `system_config`).
 *
 * Only feature flags are exposed here: they are the configuration an
 * administrator toggles at runtime, and toggling one is the privileged command
 * that exercises `admin:feature-flags:write` end to end.
 */

export interface FeatureFlagRecord {
  readonly key: string;
  readonly scope: string;
  readonly scopeRef: string | null;
  readonly enabled: boolean;
  readonly rolloutPercentage: number;
  readonly description: string | null;
  readonly updatedAt: Date;
}

/**
 * Both sides of a toggle.
 *
 * The previous value is returned so the caller can write it into the audit
 * record: "feature X was on, now off" is the fact an investigation needs, and
 * storing only the new value would not answer what changed.
 */
export interface FeatureFlagChange {
  readonly before: FeatureFlagRecord;
  readonly after: FeatureFlagRecord;
}

export interface FeatureFlagRepository {
  list(): Promise<readonly FeatureFlagRecord[]>;
  /**
   * Sets the global on/off switch of one flag.
   *
   * Returns `null` when the key does not exist. It never creates a flag: a
   * toggle that silently invents a flag would let a typo define platform
   * behaviour (AGENTS.md section 52).
   */
  setEnabled(
    key: string,
    enabled: boolean,
    updatedByUserId: string | null,
  ): Promise<FeatureFlagChange | null>;
}
