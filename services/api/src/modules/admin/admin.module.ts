import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ADMIN_READ_MODEL } from './admin.tokens.js';
import { PrismaAdminReadModel } from './infrastructure/prisma-admin-read-model.js';

/**
 * The admin surface (AGENTS.md section 12).
 *
 * It calls `AuditService` and `PlatformService` - the owning modules'
 * application services - and never their repositories, which is the dependency
 * direction docs/MODULE_BOUNDARIES.md allows for `admin`.
 */
@Module({
  imports: [AuditModule, PlatformModule],
  controllers: [AdminController],
  providers: [
    PrismaAdminReadModel,
    { provide: ADMIN_READ_MODEL, useExisting: PrismaAdminReadModel },
    AdminService,
  ],
})
export class AdminModule {}
