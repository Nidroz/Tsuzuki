// errors of the catalog http layer (src/core/catalog/http/) and of the provider failure monitor
// (src/core/catalog/catalog-failure-monitor.ts). messages never hold a url, a query string, search
// text or an underlying error message, and no cause is attached: search text is user input and
// these errors reach the error reporter

/** base class of every catalog request failure. */
export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogError';
  }
}

/** the provider answered with a non-2xx status; `retryAfterMs` comes from its Retry-After header. */
export class CatalogHttpError extends CatalogError {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, retryAfterMs: number | null) {
    super(`Catalog request failed with HTTP ${String(status)}`);
    this.name = 'CatalogHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const HTTP_NOT_FOUND = 404;

/**
 * the provider has no such title: a 404, a normal answer for a missing id (gaps in MAL ids, a stale
 * library row, a deep link to a missing id), shown as "not found" rather than as a failure.
 */
export const isCatalogNotFoundError = (error: unknown): boolean =>
  error instanceof CatalogHttpError && error.status === HTTP_NOT_FOUND;

/** the request or its body could not be transferred (offline, dns, connection reset). */
export class CatalogNetworkError extends CatalogError {
  constructor() {
    super('Catalog request failed: network error');
    this.name = 'CatalogNetworkError';
  }
}

/** no complete response within `timeoutMs`, headers and body included. */
export class CatalogTimeoutError extends CatalogError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Catalog request timed out after ${String(timeoutMs)} ms`);
    this.name = 'CatalogTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** the response body is not the expected payload (invalid json, or a schema mismatch in adapters). */
export class CatalogResponseError extends CatalogError {
  constructor() {
    super('Catalog response is malformed');
    this.name = 'CatalogResponseError';
  }
}

/**
 * the caller aborted the request. named `AbortError`, like a native abort, so code that recognizes
 * cancellations by name treats it as one (Hermes has no `DOMException` to throw instead).
 */
export class CatalogAbortedError extends CatalogError {
  constructor() {
    super('Catalog request was aborted');
    this.name = 'AbortError';
  }
}

/**
 * the kinds of provider failure the failure monitor counts and reports. `client_error` is a
 * non-2xx below 500 other than 429 and 404; a 404 is never counted, it is a normal answer for a
 * missing title.
 */
export const CATALOG_FAILURE_KINDS = [
  'server_error',
  'rate_limited',
  'client_error',
  'timeout',
  'malformed_response',
] as const;

export type CatalogFailureKind = (typeof CATALOG_FAILURE_KINDS)[number];

/**
 * a catalog provider keeps failing with `kind`, as reported by the failure monitor. it holds the
 * kind only: no cause, url, query or status.
 */
export class CatalogProviderFailureError extends CatalogError {
  readonly kind: CatalogFailureKind;

  constructor(kind: CatalogFailureKind) {
    super(`Catalog provider is failing: ${kind}`);
    this.name = 'CatalogProviderFailureError';
    this.kind = kind;
  }
}
