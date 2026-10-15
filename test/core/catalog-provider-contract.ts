// the contract every CatalogProvider adapter passes (docs/ARCHITECTURE.md §3), whatever the
// provider. it knows the interface, the domain and the errors only: each adapter test calls
// describeCatalogProviderContract with a harness that serves the adapter's own payloads in its own
// terms (CatalogProviderHarness). fake timers are on (test/core setup): the suite advances them
// until rate limit pauses, retries and timeouts run out. case tables and invariant checks are in
// catalog-provider-contract-cases.ts, harness types and timer helpers in
// catalog-provider-contract-support.ts, the search text limit and cover cases in
// catalog-provider-contract-boundaries.ts
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  MEDIA_ID_NAMESPACES,
  MEDIA_KINDS,
  type MediaKey,
  type MediaKind,
} from '@core/domain/media';
import {
  CatalogHttpError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '@core/errors/catalog-errors';

import {
  ABORT_CALLS,
  ADULT_CASES,
  EQUIVALENT_SEARCHES,
  ERROR_CALLS,
  GUARD_CASES,
  PAGE_CASES,
  SEARCH_ANIME,
  detailViolations,
  genreListViolations,
  pageViolations,
  summaryViolations,
} from './catalog-provider-contract-cases';
import { describeCatalogProviderBoundaries } from './catalog-provider-contract-boundaries';
import {
  attempt,
  failureOf,
  fetchPage,
  invoke,
  kindOf,
  resultOf,
  settle,
  successScenarioOf,
  track,
  waitForFirstRequest,
  type CatalogProviderHarness,
} from './catalog-provider-contract-support';

export type {
  CatalogProviderHarness,
  ContractCall,
  ContractScenario,
  PageCall,
} from './catalog-provider-contract-support';

// the instance id of a provider: lowercase letters and digits, hyphen-separated, short
const INSTANCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INSTANCE_ID_MAX_LENGTH = 32;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_TOO_MANY_REQUESTS = 429;
const ABORT_ERROR_NAME = 'AbortError';
// long past any retry sequence: whatever was left to send has been sent
const LONG_AFTER_MS = 60_000;

const httpStatusOf = (error: unknown): number | null =>
  error instanceof CatalogHttpError ? error.status : null;

/** registers the contract suite of one provider adapter. */
export const describeCatalogProviderContract = <TRequest>(
  harness: CatalogProviderHarness<TRequest>,
): void => {
  const detailKey = (kind: MediaKind): MediaKey => harness.detailKey(kind);

  describe(`${harness.name} catalog provider contract`, () => {
    // whatever the case, the provider is never asked to filter content (ADR-0004)
    afterEach(() => {
      const filtered = harness.requests().filter((request) => harness.sendsContentFilter(request));
      expect(filtered).toStrictEqual([]);
    });

    it('names a known id namespace and a short slug instance id', () => {
      const provider = harness.createProvider();

      expect(MEDIA_ID_NAMESPACES).toContain(provider.namespace);
      expect(provider.instanceId).toMatch(INSTANCE_ID_PATTERN);
      expect(provider.instanceId.length).toBeLessThanOrEqual(INSTANCE_ID_MAX_LENGTH);
    });

    describe.each(PAGE_CASES)('$label', ({ call, page }) => {
      it('returns the requested page of valid items', async () => {
        harness.serve('page', call);
        const provider = harness.createProvider();

        const result = await resultOf(fetchPage(provider, call, page));

        expect(pageViolations(result, page)).toStrictEqual([]);
        expect(result.items.length).toBeGreaterThanOrEqual(2);
        const kind = kindOf(call);
        expect(
          result.items.flatMap((item) => summaryViolations(item, provider.namespace, kind)),
        ).toStrictEqual([]);
      });

      it('returns an empty page with no next page', async () => {
        harness.serve('empty-page', call);

        const result = await resultOf(fetchPage(harness.createProvider(), call, page));

        expect(pageViolations(result, page)).toStrictEqual([]);
        expect(result.items).toStrictEqual([]);
        expect(result.hasNextPage).toBe(false);
      });
    });

    it.each(MEDIA_KINDS)('returns the requested %s detail', async (kind) => {
      harness.serve('detail', { method: 'getDetail', kind });
      const provider = harness.createProvider();
      const key = detailKey(kind);

      const detail = await resultOf(provider.getDetail(key));

      expect(detail.key).toStrictEqual(key);
      expect(summaryViolations(detail, provider.namespace, kind)).toStrictEqual([]);
      expect(detailViolations(detail)).toStrictEqual([]);
    });

    it.each(MEDIA_KINDS)('lists the %s genres', async (kind) => {
      harness.serve('genres', { method: 'getGenres', kind });

      const genres = await resultOf(harness.createProvider().getGenres(kind));

      expect(genres.length).toBeGreaterThan(0);
      expect(genreListViolations(genres)).toStrictEqual([]);
    });

    it.each(ADULT_CASES)(
      'BR-06: $scenario flags $call.method $call.kind as adult',
      async ({ scenario, call }) => {
        harness.serve(scenario, call);
        const provider = harness.createProvider();

        const items =
          call.method === 'getDetail'
            ? [await resultOf(provider.getDetail(detailKey(call.kind)))]
            : (await resultOf(fetchPage(provider, call, 1))).items;

        expect(items.length).toBeGreaterThan(0);
        expect(items.map((item) => item.isAdult)).toStrictEqual(items.map(() => true));
      },
    );

    describe('once the retries settle', () => {
      it.each(ERROR_CALLS)('a persistent 5xx rejects $method with its status', async (call) => {
        harness.serve('server-error', call);

        const error = await failureOf(invoke(harness.createProvider(), call, detailKey));

        expect(error).toBeInstanceOf(CatalogHttpError);
        expect(httpStatusOf(error)).toBeGreaterThanOrEqual(HTTP_SERVER_ERROR_MIN);
      });

      it.each(ERROR_CALLS)('a persistent 429 rejects $method with its status', async (call) => {
        harness.serve('rate-limited', call);

        const error = await failureOf(invoke(harness.createProvider(), call, detailKey));

        expect(error).toBeInstanceOf(CatalogHttpError);
        expect(httpStatusOf(error)).toBe(HTTP_TOO_MANY_REQUESTS);
      });

      it.each(ERROR_CALLS)('a malformed payload rejects $method', async (call) => {
        harness.serve('malformed', call);

        const error = await failureOf(invoke(harness.createProvider(), call, detailKey));

        expect(error).toBeInstanceOf(CatalogResponseError);
      });

      it.each(ERROR_CALLS)('no answer rejects $method with a timeout', async (call) => {
        harness.serve('hanging', call);

        const error = await failureOf(invoke(harness.createProvider(), call, detailKey));

        expect(error).toBeInstanceOf(CatalogTimeoutError);
      });
    });

    describe('aborts', () => {
      it.each(ABORT_CALLS)(
        'a pre-aborted signal rejects $method, sending nothing',
        async (call) => {
          harness.serve(successScenarioOf(call), call);
          const controller = new AbortController();
          controller.abort();

          const error = await failureOf(
            invoke(harness.createProvider(), call, detailKey, controller.signal),
          );

          expect(error).toMatchObject({ name: ABORT_ERROR_NAME });
          expect(harness.requests()).toHaveLength(0);
        },
      );

      it.each(ABORT_CALLS)(
        'an abort in flight rejects $method, sending nothing more',
        async (call) => {
          harness.serve('hanging', call);
          const controller = new AbortController();
          const tracked = track(
            invoke(harness.createProvider(), call, detailKey, controller.signal),
          );
          await waitForFirstRequest(() => harness.requests());
          const sent = harness.requests().length;
          expect(sent).toBeGreaterThan(0);

          controller.abort();
          const outcome = await settle(tracked);

          expect(outcome).toMatchObject({ status: 'rejected', reason: { name: ABORT_ERROR_NAME } });
          await jest.advanceTimersByTimeAsync(LONG_AFTER_MS);
          expect(harness.requests()).toHaveLength(sent);
        },
      );
    });

    it.each(GUARD_CASES)(
      'rejects $label with a RangeError before any request',
      async ({ call, run }) => {
        harness.serve(successScenarioOf(call), call);
        const provider = harness.createProvider();

        const error = await failureOf(attempt(() => run(provider, detailKey('anime'))));

        expect(error).toBeInstanceOf(RangeError);
        expect(harness.requests()).toHaveLength(0);
      },
    );

    it.each(EQUIVALENT_SEARCHES)(
      'sends one request for concurrent searches with $label',
      async ({ first, second }) => {
        harness.serve('page', SEARCH_ANIME);
        const provider = harness.createProvider();

        const firstOutcome = track(provider.search(first));
        const secondOutcome = track(provider.search(second));
        const settled = [await settle(firstOutcome), await settle(secondOutcome)];

        expect(settled.map(({ status }) => status)).toStrictEqual(['fulfilled', 'fulfilled']);
        expect(settled[1]).toStrictEqual(settled[0]);
        expect(harness.requests()).toHaveLength(1);
      },
    );

    describeCatalogProviderBoundaries(harness);
  });
};
