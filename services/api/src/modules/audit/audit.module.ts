import { Module } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { AUDIT_LOG_REPOSITORY, RISK_EVENT_READER } from './audit.tokens.js';
import { PrismaAuditLogRepository } from './infrastructure/prisma-audit.repository.js';
import { PrismaRiskEventReader } from './infrastructure/prisma-risk-event-reader.repository.js';

/**
 * Audit records (AGENTS.md sections 12, 29).
 *
 * `record` and the two list operations are the module's entire public surface.
 * Nothing outside it touches `audit_logs` or `risk_events` directly, so the
 * "every privileged action is audited" rule has one place to be enforced.
 */
@Module({
  providers: [
    PrismaAuditLogRepository,
    PrismaRiskEventReader,
    { provide: AUDIT_LOG_REPOSITORY, useExisting: PrismaAuditLogRepository },
    { provide: RISK_EVENT_READER, useExisting: PrismaRiskEventReader },
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
