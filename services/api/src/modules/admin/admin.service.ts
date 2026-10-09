import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminAuditLog,
  AdminFeatureFlag,
  AdminPanelSummary,
  AdminRiskEvent,
} from '@deliveryuy/types';
import type { PagedResult } from '../../common/pagination/paged-result.js';
import type { AuditActor } from '../audit/audit.ports.js';
import { AuditService } from '../audit/audit.service.js';
import { PlatformService } from '../platform/platform.service.js';
import type { AdminReadModel } from './admin.ports.js';
import { ADMIN_READ_MODEL } from './admin.tokens.js';

/** The audit action recorded when an administrator toggles a flag. */
export const FEATURE_FLAG_TOGGLED_ACTION = 'feature-flag.toggled';

export interface AdminAuditLogQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly action?: string;
}

export interface AdminRiskEventQuery {
  readonly limit: number;
  readonly cursor?: string;
  readonly type?: string;
}

/**
 * Privileged admin use cases (docs/MODULE_BOUNDARIES.md: `admin` owns read
 * models and privileged commands, and calls other modules' services rather than
 * their repositories).
 *
 * Authorization is not decided here. Every method is reached only through a
 * route that already declared the `admin:*` permission it requires, so the
 * policy lives on the route and the service stays about the work itself.
 */
@Injectable()
export class AdminService {
  public constructor(
    @Inject(ADMIN_READ_MODEL) private readonly readModel: AdminReadModel,
    private readonly audit: AuditService,
    private readonly platform: PlatformService,
  ) {}

  public panel(): Promise<AdminPanelSummary> {
    return this.readModel.summary();
  }

  public listAuditLogs(query: AdminAuditLogQuery): Promise<PagedResult<AdminAuditLog>> {
    return this.audit.listAuditLogs(query);
  }

  public listRiskEvents(query: AdminRiskEventQuery): Promise<PagedResult<AdminRiskEvent>> {
    return this.audit.listRiskEvents(query);
  }

  public listFeatureFlags(): Promise<readonly AdminFeatureFlag[]> {
    return this.platform.listFeatureFlags();
  }

  /**
   * Toggles a feature flag and records who did it (AGENTS.md sections 53, 93).
   *
   * The change and its audit entry are two writes, not one transaction: the
   * audit port has no transaction handle yet. The record is awaited, so a failed
   * audit write fails the request instead of dropping the entry silently, but a
   * crash between the two writes could still leave a changed flag with no record.
   * Closing that gap needs a transactional unit of work - the same primitive the
   * payment module will require - and it is tracked in PROJECT_STATE.md rather
   * than presented here as already atomic.
   */
  public async setFeatureFlagEnabled(
    actor: AuditActor,
    key: string,
    enabled: boolean,
  ): Promise<AdminFeatureFlag> {
    const change = await this.platform.setFeatureFlagEnabled(key, enabled, actor.userId);

    await this.audit.record(actor, {
      action: FEATURE_FLAG_TOGGLED_ACTION,
      entityType: 'FeatureFlag',
      entityId: change.after.key,
      metadata: {
        enabled: change.after.enabled,
        previousEnabled: change.before.enabled,
      },
    });

    return change.after;
  }
}
