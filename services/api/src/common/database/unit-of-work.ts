import type { InjectionToken } from '@nestjs/common';
import type { Prisma } from '@deliveryuy/database';

/**
 * A Prisma transaction client.
 *
 * Passing it to a repository makes that write join the caller's transaction
 * instead of opening its own, which is what lets two modules' writes commit or
 * roll back together (AGENTS.md section 83). It is the only type a repository
 * needs in order to be composable; the concrete client stays in infrastructure.
 */
export type TransactionContext = Prisma.TransactionClient;

/**
 * Runs a set of writes as one atomic unit.
 *
 * The port exists so a service can compose other modules' services without
 * knowing Prisma: `admin` runs the feature-flag write and the audit write inside
 * one transaction, but it imports neither a repository nor the database client.
 * The same primitive is what the payment module will need for approval and
 * settlement.
 */
export interface UnitOfWork {
  runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

/** Injection token for {@link UnitOfWork}. */
export const UNIT_OF_WORK: InjectionToken<UnitOfWork> = 'DELIVERYUY_UNIT_OF_WORK';
