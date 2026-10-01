import { z } from 'zod';
import type { PaginationMeta } from '@deliveryuy/types';

/**
 * Thin HTTP transport for the DeliveryUY API.
 *
 * Scope and rules:
 * - it speaks only the documented envelope (`docs/API_RULES.md`);
 * - it validates every response with a schema, so a contract change surfaces as
 *   a typed error instead of `undefined` deep inside a component;
 * - it holds no business rule (AGENTS.md section 42). The backend always
 *   revalidates anything a client sends;
 * - `fetchImpl` is injected so tests never open a socket.
 */

export const paginationMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export const failureEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    correlationId: z.string().optional(),
  }),
});

export type ApiClientErrorKind =
  /** The API could not be reached (DNS, connection refused, TLS failure). */
  | 'transport'
  /** The request exceeded `timeoutMs`. */
  | 'timeout'
  /** The API answered with a non-2xx status. */
  | 'http'
  /** The API answered 2xx but the payload does not match the contract. */
  | 'contract';

export class ApiClientError extends Error {
  public constructor(
    public readonly kind: ApiClientErrorKind,
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly correlationId: string | null,
    public readonly details: Record<string, unknown> | undefined,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  /** Injectable for tests; defaults to the platform `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Sent as `Idempotency-Key`. Required by the API for state-changing
   * operations (AGENTS.md section 38); callers must supply a fresh value per
   * logical operation and reuse it when retrying.
   */
  readonly idempotencyKey?: string;
}

export interface ApiClient {
  /** Unwraps `{ "data": T }` and validates `T`. */
  getData<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
  /** Unwraps `{ "data": T[], "pagination": ... }`. */
  getPage<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<Page<T>>;
  /** Raw envelope access for non-list endpoints. */
  send<T>(path: string, schema: z.ZodType<T>, options?: RequestOptions): Promise<T>;
}

export interface Page<T> {
  readonly items: T[];
  readonly pagination: PaginationMeta;
}

function buildUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function rawRequest(path: string, requestOptions: RequestOptions = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...(requestOptions.headers ?? {}),
    };

    let payload: string | undefined;

    if (requestOptions.body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(requestOptions.body);
    }

    if (requestOptions.idempotencyKey !== undefined) {
      headers['idempotency-key'] = requestOptions.idempotencyKey;
    }

    let response: Response;

    try {
      response = await fetchImpl(buildUrl(options.baseUrl, path), {
        method: requestOptions.method ?? 'GET',
        headers,
        body: payload,
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error: unknown) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';

      throw new ApiClientError(
        isTimeout ? 'timeout' : 'transport',
        'SERVICE_UNAVAILABLE',
        isTimeout
          ? `The API did not answer within ${String(options.timeoutMs)} ms.`
          : `The API is unreachable: ${error instanceof Error ? error.message : 'unknown error'}`,
        0,
        null,
        undefined,
      );
    }

    const body = await readJsonBody(response);

    if (!response.ok) {
      const failure = failureEnvelopeSchema.safeParse(body);

      if (failure.success) {
        throw new ApiClientError(
          'http',
          failure.data.error.code,
          failure.data.error.message,
          response.status,
          failure.data.error.correlationId ?? null,
          failure.data.error.details,
        );
      }

      throw new ApiClientError(
        'http',
        'INTERNAL_ERROR',
        `Unexpected ${String(response.status)} response from the API.`,
        response.status,
        null,
        undefined,
      );
    }

    return body;
  }

  return {
    async send<T>(path: string, schema: z.ZodType<T>, requestOptions?: RequestOptions): Promise<T> {
      const body = await rawRequest(path, requestOptions);
      const parsed = schema.safeParse(body);

      if (!parsed.success) {
        throw new ApiClientError(
          'contract',
          'INVALID_RESPONSE_CONTRACT',
          `The API response for ${path} does not match the expected contract.`,
          0,
          null,
          { issues: parsed.error.issues },
        );
      }

      return parsed.data;
    },

    async getData<T>(
      path: string,
      schema: z.ZodType<T>,
      requestOptions?: RequestOptions,
    ): Promise<T> {
      const envelope = await rawRequest(path, requestOptions);

      if (typeof envelope !== 'object' || envelope === null || !('data' in envelope)) {
        throw new ApiClientError(
          'contract',
          'INVALID_RESPONSE_CONTRACT',
          `The API response for ${path} is not a success envelope.`,
          0,
          null,
          undefined,
        );
      }

      const parsed = schema.safeParse(envelope.data);

      if (!parsed.success) {
        throw new ApiClientError(
          'contract',
          'INVALID_RESPONSE_CONTRACT',
          `The API payload for ${path} does not match the expected contract.`,
          0,
          null,
          { issues: parsed.error.issues },
        );
      }

      return parsed.data;
    },

    async getPage<T>(
      path: string,
      schema: z.ZodType<T>,
      requestOptions?: RequestOptions,
    ): Promise<Page<T>> {
      const body = await rawRequest(path, requestOptions);
      const listSchema = z.object({ data: z.array(schema), pagination: paginationMetaSchema });
      const parsed = listSchema.safeParse(body);

      if (!parsed.success) {
        throw new ApiClientError(
          'contract',
          'INVALID_RESPONSE_CONTRACT',
          `The API list response for ${path} does not match the expected contract.`,
          0,
          null,
          { issues: parsed.error.issues },
        );
      }

      return { items: parsed.data.data, pagination: parsed.data.pagination };
    },
  };
}
