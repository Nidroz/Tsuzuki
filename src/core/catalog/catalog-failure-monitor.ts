// reports a catalog provider that keeps failing to the error reporter (Sentry on mobile): a few
// counted failures since the last success, close together, give one report per failure kind and
// interval. platform-agnostic: the reporter and the clock are injected by the composition root.
// a report holds the failure kind and the instance id only, never a url, query, search text,
// params, status code, response text or the original error
import {
  CatalogHttpError,
  CatalogNetworkError,
  CatalogProviderFailureError,
  CatalogResponseError,
  CatalogTimeoutError,
  isCatalogNotFoundError,
  type CatalogFailureKind,
} from '../errors/catalog-errors';
import type { ErrorReporter } from '../errors/error-reporter';
import type { CatalogProvider } from './catalog-provider';

/** counted failures since the last success that make a sustained failure. */
export const CATALOG_FAILURE_THRESHOLD = 3;

/** every counted failure of a sustained failure is at most this old when the latest one comes. */
export const CATALOG_FAILURE_WINDOW_MS = 120_000;

/** a kind already reported less than this long ago is not reported again. */
export const CATALOG_FAILURE_REPORT_INTERVAL_MS = 1_800_000;

const REPORT_SOURCE = 'catalog';
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_TOO_MANY_REQUESTS = 429;

export interface CatalogFailureMonitorOptions {
  readonly reporter: ErrorReporter;
  /**
   * monotonic clock in ms: it must never decrease. default `performance.now()`, read on each call
   * so fake timers apply.
   */
  readonly now?: () => number;
  /**
   * whether the device is online now (isDeviceOnline, src/core/query/online-manager.ts): a network
   * error is counted, as `network`, only while it returns true, since an offline device and a
   * provider outage look the same otherwise. without it, network errors are never counted.
   */
  readonly isOnline?: () => boolean;
}

// without a connectivity source, a network error never says anything about the provider
const NEVER_ONLINE = (): boolean => false;

// the kind of a failure, or null when it is not counted: a 404 (a normal answer for a missing
// title: gaps in MAL ids, a stale library row, a deep link to a missing id), a network error while
// the device is offline (an offline device and a provider outage look the same), an abort, an
// input RangeError or an unknown error
const failureKindOf = (error: Error, isOnline: () => boolean): CatalogFailureKind | null => {
  if (isCatalogNotFoundError(error)) {
    return null;
  }
  if (error instanceof CatalogNetworkError) {
    return isOnline() ? 'network' : null;
  }
  if (error instanceof CatalogHttpError) {
    if (error.status >= HTTP_SERVER_ERROR_MIN) {
      return 'server_error';
    }
    return error.status === HTTP_TOO_MANY_REQUESTS ? 'rate_limited' : 'client_error';
  }
  if (error instanceof CatalogTimeoutError) {
    return 'timeout';
  }
  if (error instanceof CatalogResponseError) {
    return 'malformed_response';
  }
  return null;
};

/**
 * `provider` with the same namespace, instance id and search text limit, whose calls are
 * watched: each method forwards the same arguments and returns the provider's own promise, so the
 * caller gets exactly its value or error. state lives in the returned provider, never in a global.
 */
export const monitorCatalogProvider = (
  provider: CatalogProvider,
  options: CatalogFailureMonitorOptions,
): CatalogProvider => {
  const { reporter } = options;
  const now = options.now ?? (() => performance.now());
  const isOnline = options.isOnline ?? NEVER_ONLINE;
  // the errors already counted: the http client rejects every caller of one request in flight
  // (a foreground call that joined a background prefetch) with the same error object, a failure of
  // the provider counted once. a new request always fails with a new error
  const counted = new WeakSet<object>();
  // the times of the counted failures since the last success, oldest first
  let streak: readonly number[] = [];
  const reportedAt = new Map<CatalogFailureKind, number>();

  const report = (kind: CatalogFailureKind, at: number): void => {
    const lastReport = reportedAt.get(kind);
    if (lastReport !== undefined && at - lastReport < CATALOG_FAILURE_REPORT_INTERVAL_MS) {
      return;
    }
    reportedAt.set(kind, at);
    reporter.captureError(new CatalogProviderFailureError(kind), {
      source: REPORT_SOURCE,
      tags: { instance: provider.instanceId, kind },
    });
  };

  const onSuccess = (): void => {
    streak = [];
  };

  const onFailure = (error: unknown): void => {
    // every counted kind is an Error: anything else thrown is never counted
    if (!(error instanceof Error) || counted.has(error)) {
      return;
    }
    const kind = failureKindOf(error, isOnline);
    if (kind === null) {
      return;
    }
    counted.add(error);
    const at = now();
    streak = [...streak.filter((failedAt) => at - failedAt <= CATALOG_FAILURE_WINDOW_MS), at];
    if (streak.length >= CATALOG_FAILURE_THRESHOLD) {
      // reported or deduplicated, the next sustained failure starts from scratch
      streak = [];
      report(kind, at);
    }
  };

  // watches the call on the side and hands back the provider's own promise
  const observe = <T>(call: Promise<T>): Promise<T> => {
    void call.then(onSuccess, onFailure);
    return call;
  };

  return {
    namespace: provider.namespace,
    instanceId: provider.instanceId,
    searchQueryMaxLength: provider.searchQueryMaxLength,
    searchGenresMax: provider.searchGenresMax,
    imageHosts: provider.imageHosts,
    search: (...args) => observe(provider.search(...args)),
    getDetail: (...args) => observe(provider.getDetail(...args)),
    getTop: (...args) => observe(provider.getTop(...args)),
    getCurrentSeason: (...args) => observe(provider.getCurrentSeason(...args)),
    getGenres: (...args) => observe(provider.getGenres(...args)),
  };
};
