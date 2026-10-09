import { Inject, Injectable } from '@nestjs/common';
import type { AdminFeatureFlag } from '@deliveryuy/types';
import { ApiException } from '../../common/errors/api-exception.js';
import { FEATURE_FLAG_REPOSITORY } from './platform.tokens.js';
import type { FeatureFlagRecord, FeatureFlagRepository } from './platform.ports.js';

/** A toggle as the wire sees it: both sides already formatted. */
export interface FeatureFlagChangeView {
  readonly before: AdminFeatureFlag;
  readonly after: AdminFeatureFlag;
}

/**
 * Runtime feature flags (AGENTS.md section 53).
 *
 * The service knows nothing about who is allowed to toggle a flag: authorization
 * is enforced by the admin endpoint's `@Permissions(...)` before this is called.
 * Mixing the two would hide the policy in a service method instead of in the
 * route that declares it.
 */
@Injectable()
export class PlatformService {
  public constructor(
    @Inject(FEATURE_FLAG_REPOSITORY) private readonly flags: FeatureFlagRepository,
  ) {}

  public async listFeatureFlags(): Promise<readonly AdminFeatureFlag[]> {
    const flags = await this.flags.list();

    return flags.map(toView);
  }

  /**
   * Toggles one flag and returns both the old and the new value.
   *
   * A missing key is `NOT_FOUND`: the caller asked to change something that does
   * not exist, which is a client mistake, not a reason to create it.
   */
  public async setFeatureFlagEnabled(
    key: string,
    enabled: boolean,
    updatedByUserId: string | null,
  ): Promise<FeatureFlagChangeView> {
    const change = await this.flags.setEnabled(key, enabled, updatedByUserId);

    if (change === null) {
      throw ApiException.notFound('NOT_FOUND', `Feature flag "${key}" does not exist.`);
    }

    return { before: toView(change.before), after: toView(change.after) };
  }
}

function toView(flag: FeatureFlagRecord): AdminFeatureFlag {
  return {
    key: flag.key,
    scope: flag.scope,
    scopeRef: flag.scopeRef,
    enabled: flag.enabled,
    rolloutPercentage: flag.rolloutPercentage,
    description: flag.description,
    updatedAt: flag.updatedAt.toISOString(),
  };
}
