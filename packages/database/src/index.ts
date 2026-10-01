export {
  PrismaClient,
  checkDatabaseHealth,
  createDatabaseClient,
  type DatabaseClientOptions,
  type DependencyHealth,
  type HealthCheckStatus,
} from './client.js';

export type { Prisma } from '@prisma/client';
