import type { InjectionToken } from '@nestjs/common';
import type { FeatureFlagRepository } from './platform.ports.js';

/** Injection token for the feature flag port. */
export const FEATURE_FLAG_REPOSITORY: InjectionToken<FeatureFlagRepository> =
  'DELIVERYUY_FEATURE_FLAG_REPOSITORY';
