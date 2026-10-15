// the harness types, calls and fake timer helpers of the catalog provider contract suite
// (catalog-provider-contract.ts). provider-agnostic: the catalog interface and the domain only
import { jest } from '@jest/globals';

import type { CatalogProvider, MediaSummary, Page } from '@core/catalog/catalog-provider';
import type { MediaKey, MediaKind } from '@core/domain/media';

/**
 * what the harness answers to every request until the next `serve`:
 * - `page`: a page of at least 2 distinct items of the call's kind (anime for the season);
 * - `empty-page`: a page with no item and no next page;
 * - `detail`: the detail of `detailKey(kind)`;
 * - `genres`: the genre list of the kind;
 * - `adult-genre`: for a search, a page whose items all have a Hentai or Erotica genre, wherever
 *   the provider puts them; for a detail, `detailKey(kind)` with such a genre. never rated Rx;
 * - `adult-rating`: the same for an Rx-rated anime with no adult genre;
 * - `server-error`: a 5xx, every time;
 * - `rate-limited`: a 429, every time;
 * - `malformed`: a 2xx body that fails the adapter's schema for the call;
 * - `hanging`: no answer, ever;
 * - `foreign-image`: a page of at least 1 item of the call's kind (anime for the season) whose
 *   covers are all outside `allowedImageHosts`: on another host, or over http.
 */
export type ContractScenario =
  | 'page'
  | 'empty-page'
  | 'detail'
  | 'genres'
  | 'adult-genre'
  | 'adult-rating'
  | 'server-error'
  | 'rate-limited'
  | 'malformed'
  | 'hanging'
  | 'foreign-image';

/** the provider method a scenario answers, with the kind the contract passes to it. */
export type ContractCall =
  | { readonly method: 'search'; readonly kind: MediaKind }
  | { readonly method: 'getTop'; readonly kind: MediaKind }
  | { readonly method: 'getCurrentSeason' }
  | { readonly method: 'getDetail'; readonly kind: MediaKind }
  | { readonly method: 'getGenres'; readonly kind: MediaKind };

/** the calls answered with a page. */
export type PageCall = Extract<
  ContractCall,
  { readonly method: 'search' | 'getTop' | 'getCurrentSeason' }
>;

/**
 * an adapter's side of the contract; `TRequest` is whatever the adapter test records of a request
 * (a url for a GET api, a body for a graphql one).
 */
export interface CatalogProviderHarness<TRequest> {
  /** the describe title. */
  readonly name: string;
  /** a new provider, called once per test, with deterministic options (e.g. a fixed jitter). */
  readonly createProvider: () => CatalogProvider;
  /** answers every request of the provider with `scenario` for `call`, and restarts the record. */
  readonly serve: (scenario: ContractScenario, call: ContractCall) => void;
  /** the requests the provider sent since the last `serve`, in order, recorded when sent. */
  readonly requests: () => readonly TRequest[];
  /** the adapter's own ADR-0004 predicate: whether a request asks the provider to filter content. */
  readonly sendsContentFilter: (request: TRequest) => boolean;
  /** the key of the detail served for `kind`, in the provider's namespace. */
  readonly detailKey: (kind: MediaKind) => MediaKey;
  /** the hosts the adapter takes covers from (`toAllowedImageUrl`, src/core/catalog/image-url.ts). */
  readonly allowedImageHosts: readonly string[];
}

/** the current season is an anime list. */
export const SEASON_KIND: MediaKind = 'anime';
/** the search text of the contract's searches. */
export const CONTRACT_QUERY = 'contract';

export const kindOf = (call: ContractCall): MediaKind =>
  call.method === 'getCurrentSeason' ? SEASON_KIND : call.kind;

/** the scenario a call succeeds with. */
export const successScenarioOf = (call: ContractCall): ContractScenario => {
  switch (call.method) {
    case 'getDetail':
      return 'detail';
    case 'getGenres':
      return 'genres';
    default:
      return 'page';
  }
};

export const fetchPage = (
  provider: CatalogProvider,
  call: PageCall,
  page: number,
  signal?: AbortSignal,
): Promise<Page<MediaSummary>> => {
  switch (call.method) {
    case 'search':
      return provider.search({ kind: call.kind, query: CONTRACT_QUERY, page }, signal);
    case 'getTop':
      return provider.getTop(call.kind, page, signal);
    case 'getCurrentSeason':
      return provider.getCurrentSeason(page, signal);
  }
};

/** calls the method of `call`, on page 1 for a paginated one. */
export const invoke = (
  provider: CatalogProvider,
  call: ContractCall,
  detailKey: (kind: MediaKind) => MediaKey,
  signal?: AbortSignal,
): Promise<unknown> => {
  switch (call.method) {
    case 'getDetail':
      return provider.getDetail(detailKey(call.kind), signal);
    case 'getGenres':
      return provider.getGenres(call.kind, signal);
    default:
      return fetchPage(provider, call, 1, signal);
  }
};

/** a synchronous throw becomes a rejection, so both count as failing before any request. */
export const attempt = (run: () => Promise<unknown>): Promise<unknown> =>
  Promise.resolve().then(run);

export type Settled<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: unknown };

/** the outcome of a call so far, its rejection handled from the start. */
export interface Tracked<T> {
  readonly outcome: Settled<T> | null;
}

export const track = <T>(call: Promise<T>): Tracked<T> => {
  const tracked: { outcome: Settled<T> | null } = { outcome: null };
  void call.then(
    (value) => {
      tracked.outcome = { status: 'fulfilled', value };
    },
    (reason: unknown) => {
      tracked.outcome = { status: 'rejected', reason };
    },
  );
  return tracked;
};

// fake time steps: any rate limit pause, backoff, timeout and retry deadline runs out within the limit
const SETTLE_STEP_MS = 1_000;
const SETTLE_LIMIT_MS = 600_000;
const REQUEST_WAIT_STEP_MS = 10;
const REQUEST_WAIT_LIMIT_MS = 1_000;

/** advances the fake clock until the call settles; fails past `SETTLE_LIMIT_MS`. */
export const settle = async <T>(tracked: Tracked<T>): Promise<Settled<T>> => {
  await jest.advanceTimersByTimeAsync(0);
  for (
    let elapsed = 0;
    tracked.outcome === null && elapsed < SETTLE_LIMIT_MS;
    elapsed += SETTLE_STEP_MS
  ) {
    await jest.advanceTimersByTimeAsync(SETTLE_STEP_MS);
  }
  if (tracked.outcome === null) {
    throw new Error(`the call did not settle within ${String(SETTLE_LIMIT_MS)} ms of fake time`);
  }
  return tracked.outcome;
};

/** the value of a call once settled; its error is rethrown. */
export const resultOf = async <T>(call: Promise<T>): Promise<T> => {
  const outcome = await settle(track(call));
  if (outcome.status === 'rejected') {
    throw outcome.reason;
  }
  return outcome.value;
};

/** the error of a call once settled; a call that resolves fails the test. */
export const failureOf = async (call: Promise<unknown>): Promise<unknown> => {
  const outcome = await settle(track(call));
  if (outcome.status === 'fulfilled') {
    throw new Error('expected the call to reject, it resolved');
  }
  return outcome.reason;
};

/** advances the fake clock in small steps until a first request is sent. */
export const waitForFirstRequest = async (requests: () => readonly unknown[]): Promise<void> => {
  await jest.advanceTimersByTimeAsync(0);
  for (
    let elapsed = 0;
    requests().length === 0 && elapsed < REQUEST_WAIT_LIMIT_MS;
    elapsed += REQUEST_WAIT_STEP_MS
  ) {
    await jest.advanceTimersByTimeAsync(REQUEST_WAIT_STEP_MS);
  }
};
