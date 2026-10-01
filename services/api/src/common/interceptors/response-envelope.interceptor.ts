import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { PaginationMeta } from '@deliveryuy/types';

/**
 * Wraps successful responses in the documented envelope (docs/API_RULES.md).
 *
 * Controllers return domain objects; the wire format is decided in exactly one
 * place so that new endpoints cannot accidentally answer with a raw array or a
 * bare object.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  { data: T; pagination?: PaginationMeta }
> {
  public intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: T; pagination?: PaginationMeta }> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}
