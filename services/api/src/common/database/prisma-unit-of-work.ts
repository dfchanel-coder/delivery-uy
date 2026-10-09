import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@deliveryuy/database';
import type { TransactionContext, UnitOfWork } from './unit-of-work.js';

/**
 * Prisma-backed unit of work.
 *
 * `$transaction(fn)` runs the callback in one database transaction: a throw
 * rolls back every write the callback made, whichever module issued it. The
 * interactive form is used rather than an array of promises because the audit
 * entry depends on the value the flag write returns, so the two cannot be
 * expressed as two statements resolved in parallel.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  public constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient) {}

  public runInTransaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(tx));
  }
}
