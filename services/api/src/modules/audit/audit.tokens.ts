import type { InjectionToken } from '@nestjs/common';
import type { AuditLogRepository, RiskEventReader } from './audit.ports.js';

/**
 * Injection tokens for the audit ports.
 *
 * The ports are interfaces with no runtime value, so they cannot be used as
 * tokens directly. Keeping them here means the module wiring and a test that
 * overrides a provider import from the same place.
 */
export const AUDIT_LOG_REPOSITORY: InjectionToken<AuditLogRepository> =
  'DELIVERYUY_AUDIT_LOG_REPOSITORY';

export const RISK_EVENT_READER: InjectionToken<RiskEventReader> = 'DELIVERYUY_RISK_EVENT_READER';
