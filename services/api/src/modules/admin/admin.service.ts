import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminAuditLog,
  AdminFeatureFlag,
  AdminPanelSummary,
  AdminRiskEvent,
} from '@deliveryuy/types';
import { UNIT_OF_WORK, type UnitOfWork } from '../../common/database/unit-of-work.js';
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
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
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
   * Both writes run inside one unit of work: the flag update and its audit entry
   * commit together or not at all. A crash after the update but before the audit
   * insert now rolls the update back, so a flag can no longer change with no
   * record of who changed it (AGENTS.md section 83). A missing flag throws
   * `NOT_FOUND` from the platform service inside the transaction, which rolls
   * back and writes no audit entry.
   */
  public async setFeatureFlagEnabled(
    actor: AuditActor,
    key: string,
    enabled: boolean,
  ): Promise<AdminFeatureFlag> {
    return this.unitOfWork.runInTransaction(async (tx) => {
      const change = await this.platform.setFeatureFlagEnabled(key, enabled, actor.userId, tx);

      await this.audit.record(
        actor,
        {
          action: FEATURE_FLAG_TOGGLED_ACTION,
          entityType: 'FeatureFlag',
          entityId: change.after.key,
          metadata: {
            enabled: change.after.enabled,
            previousEnabled: change.before.enabled,
          },
        },
        tx,
      );

      return change.after;
    });
  }
}
