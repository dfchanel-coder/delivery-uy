import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../common/database/database.module.js';
import { SecurityModule } from '../../common/security/security.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { USER_ADMIN_REPOSITORY } from './users.tokens.js';
import { PrismaUserAdminRepository } from './infrastructure/prisma-user-admin.repository.js';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: USER_ADMIN_REPOSITORY, useClass: PrismaUserAdminRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
