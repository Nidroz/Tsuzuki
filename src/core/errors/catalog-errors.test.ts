import { describe, expect, it } from '@jest/globals';

import {
  CATALOG_FAILURE_KINDS,
  CatalogAbortedError,
  CatalogError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogProviderFailureError,
  CatalogResponseError,
  CatalogTimeoutError,
} from './catalog-errors';

const RETRY_AFTER_MS = 2_000;
const TIMEOUT_MS = 10_000;
// nothing of a request may reach a message: urls, hosts, query strings, search text
const REQUEST_TRACE = /https?:|\/\/|\?|=|&|frieren/i;

const errors = [
  new CatalogHttpError(503, RETRY_AFTER_MS),
  new CatalogNetworkError(),
  new CatalogTimeoutError(TIMEOUT_MS),
  new CatalogResponseError(),
  new CatalogAbortedError(),
  new CatalogProviderFailureError('server_error'),
];

describe('catalog errors', () => {
  it('names each error and keeps them all catalog errors', () => {
    expect(errors.map(({ name }) => name)).toStrictEqual([
      'CatalogHttpError',
      'CatalogNetworkError',
      'CatalogTimeoutError',
      'CatalogResponseError',
      'AbortError',
      'CatalogProviderFailureError',
    ]);
    for (const error of errors) {
      expect(error).toBeInstanceOf(CatalogError);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('keeps the status and retry delay of an http error', () => {
    const error = new CatalogHttpError(429, null);
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBeNull();
    expect(error.message).toBe('Catalog request failed with HTTP 429');
    expect(new CatalogHttpError(503, RETRY_AFTER_MS).retryAfterMs).toBe(RETRY_AFTER_MS);
  });

  it('keeps the timeout of a timeout error', () => {
    const error = new CatalogTimeoutError(TIMEOUT_MS);
    expect(error.timeoutMs).toBe(TIMEOUT_MS);
    expect(error.message).toBe('Catalog request timed out after 10000 ms');
  });

  it('names an aborted request AbortError, like a native abort', () => {
    const error = new CatalogAbortedError();
    expect(error.name).toBe('AbortError');
    expect(error).toBeInstanceOf(CatalogError);
  });

  it('never puts request details or a cause in a message', () => {
    for (const error of errors) {
      expect(error.message).not.toMatch(REQUEST_TRACE);
      expect(error.cause).toBeUndefined();
    }
  });

  it('names the kind of a provider failure, and only the kind', () => {
    expect(CATALOG_FAILURE_KINDS).toStrictEqual([
      'server_error',
      'rate_limited',
      'client_error',
      'timeout',
      'malformed_response',
    ]);
    for (const kind of CATALOG_FAILURE_KINDS) {
      const error = new CatalogProviderFailureError(kind);
      expect(error.kind).toBe(kind);
      expect(error.message).toBe(`Catalog provider is failing: ${kind}`);
      expect(Object.keys(error).sort()).toStrictEqual(['kind', 'name']);
    }
  });
});
