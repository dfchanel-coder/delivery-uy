import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import type { PaginationMeta } from '@deliveryuy/types';
import { PagedResult } from '../pagination/paged-result.js';

/**
 * Wraps successful responses in the documented envelope (docs/API_RULES.md).
 *
 * Controllers return domain objects; the wire format is decided in exactly one
 * place so that new endpoints cannot accidentally answer with a raw array or a
 * bare object.
 *
 * A `PagedResult` is the one shape that is unwrapped instead of nested: its
 * items become `data` and its cursor becomes `pagination`, which is what the
 * pagination contract promises. Every other value is wrapped unchanged.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  { data: unknown; pagination?: PaginationMeta }
> {
  public intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ data: unknown; pagination?: PaginationMeta }> {
    return next.handle().pipe(map((value) => this.envelope(value)));
  }

  private envelope(value: T): { data: unknown; pagination?: PaginationMeta } {
    if (value instanceof PagedResult) {
      return {
        data: value.items,
        pagination: { nextCursor: value.nextCursor, hasMore: value.hasMore },
      };
    }

    return { data: value };
  }
}
