import { Global, Inject, Injectable, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, createDatabaseClient } from '@deliveryuy/database';
import { AppConfigModule } from '../config/app-config.module.js';
import { AppConfigService } from '../config/app-config.service.js';

/**
 * Closes the shared client on shutdown.
 *
 * `enableShutdownHooks()` is already on, so this runs on SIGTERM and on
 * `app.close()`. Without it the process would exit with the pool still open,
 * which turns a rolling deploy into "too many connections" on the database.
 */
@Injectable()
export class DatabaseShutdown implements OnModuleDestroy {
  public constructor(@Inject(PrismaClient) private readonly client: PrismaClient) {}

  public async onModuleDestroy(): Promise<void> {
    const logger = new Logger(DatabaseShutdown.name);

    try {
      await this.client.$disconnect();
    } catch (error: unknown) {
      // A failed disconnect must not mask the reason the process is stopping.
      logger.warn(`Database client did not close cleanly: ${String(error)}`);
    }
  }
}

/**
 * Shared PostgreSQL client.
 *
 * One client per process: it owns a connection pool, so creating one per request
 * or per repository would exhaust connections under load. Prisma connects
 * lazily, so booting the API without a reachable database still succeeds and
 * the readiness probe is what reports the outage.
 *
 * The health module keeps its own short-lived clients on purpose, so a poisoned
 * pool cannot make the probe lie.
 */
@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: PrismaClient,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PrismaClient => {
        const { url, poolSize } = config.database;

        return createDatabaseClient({ url, poolSize, logLevel: 'error' });
      },
    },
    DatabaseShutdown,
  ],
  exports: [PrismaClient],
})
export class DatabaseModule {}
