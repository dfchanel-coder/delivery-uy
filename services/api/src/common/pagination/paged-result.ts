/**
 * A page of a cursor-paginated list (AGENTS.md section 55).
 *
 * Application services return this; `ResponseEnvelopeInterceptor` recognises it
 * and emits `{ data: items, pagination: { nextCursor, hasMore } }`, which is the
 * envelope documented in docs/API_RULES.md.
 *
 * The marker is a class rather than a structural shape on purpose. If the
 * interceptor looked for any object with `items` and `nextCursor`, a domain
 * object that happened to carry those two keys would be flattened into a
 * response the endpoint never declared. An `instanceof` check cannot make that
 * mistake.
 */
export class PagedResult<T> {
  public constructor(
    public readonly items: readonly T[],
    public readonly nextCursor: string | null,
  ) {}

  /** `hasMore` is derived, never stored: one of the two could otherwise lie. */
  public get hasMore(): boolean {
    return this.nextCursor !== null;
  }
}
