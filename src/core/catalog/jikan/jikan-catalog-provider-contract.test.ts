import { beforeEach, describe, expect, it } from '@jest/globals';

import {
  describeCatalogProviderContract,
  type CatalogProviderHarness,
  type ContractCall,
  type ContractScenario,
} from '../../../../test/core/catalog-provider-contract';
import { kindOf } from '../../../../test/core/catalog-provider-contract-support';
import { server } from '../../../../test/core/msw-server';
import type { MediaKind } from '../../domain/media';
import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanManga,
  buildJikanPage,
  genreRef,
  withoutKeys,
} from './__fixtures__/jikan-builders';
import {
  jikanError,
  jikanHandler,
  jsonAnswer,
  neverAnswer,
  type JikanAnswer,
  type JikanRequest,
} from './__fixtures__/jikan-handlers';
import {
  DETAIL_RECORDINGS,
  GENRE_RECORDINGS,
  PAGE_RECORDINGS,
} from './__fixtures__/tenrai-recordings';
import { createJikanCatalogProvider } from './jikan-catalog-provider';
import {
  JIKAN_NAMESPACE,
  TENRAI_INSTANCE,
  selfHostedJikanInstance,
  type JikanInstance,
} from './jikan-instances';

// the provider-agnostic contract (test/core/catalog-provider-contract.ts) run on the jikan adapter
// for two instances, tenrai and a self-hosted jikan, each served by msw on its own base url: the
// recorded tenrai responses for the page, empty page, detail and genre scenarios, the builders for
// the adult, malformed and error ones

type JsonObject = Record<string, unknown>;

// not a real host: msw answers every request, nothing reaches the network
const SELF_HOSTED_BASE = 'https://jikan.example.test/v4';

// query parameters that ask jikan to filter content (ADR-0004)
const CONTENT_FILTER_PARAMS: ReadonlySet<string> = new Set([
  'sfw',
  'sfw-strict',
  'rating',
  'unapproved',
  'continuing',
]);

// the ids of the recorded details
const DETAIL_IDS = { anime: 52991, manga: 121496 } as const satisfies Record<MediaKind, number>;

const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_TOO_MANY_REQUESTS = 429;
// ids of the synthetic page items
const SYNTHETIC_IDS = [301, 302] as const;

// whether `url` carries a content filter as a query parameter name, whatever its value
const sendsContentFilter = (url: string): boolean =>
  [...new URL(url).searchParams.keys()].some((name) => CONTENT_FILTER_PARAMS.has(name));

const itemOf = (kind: MediaKind, overrides: JsonObject): JsonObject =>
  kind === 'anime' ? buildJikanAnime(overrides) : buildJikanManga(overrides);

// the BR-06 inputs: an explicit genre for any kind, an Rx rating for an anime; never both
const adultOverrides = (scenario: ContractScenario, kind: MediaKind): JsonObject => {
  if (scenario === 'adult-genre') {
    return { explicit_genres: [genreRef(12, 'Hentai', kind)] };
  }
  if (kind !== 'anime') {
    throw new Error('an Rx rating applies to anime only');
  }
  return { rating: 'Rx - Hentai' };
};

const pathOf = (call: ContractCall): string => {
  switch (call.method) {
    case 'search':
      return `/${call.kind}`;
    case 'getTop':
      return `/top/${call.kind}`;
    case 'getCurrentSeason':
      return '/seasons/now';
    case 'getDetail':
      return `/${call.kind}/${String(DETAIL_IDS[call.kind])}`;
    case 'getGenres':
      return `/genres/${call.kind}`;
  }
};

const recordedPageOf = (call: ContractCall): JsonObject => {
  switch (call.method) {
    case 'search':
      return call.kind === 'anime'
        ? PAGE_RECORDINGS.animeSearch.body
        : PAGE_RECORDINGS.mangaSearch.body;
    case 'getTop':
      return call.kind === 'anime' ? PAGE_RECORDINGS.topAnime.body : PAGE_RECORDINGS.topManga.body;
    default:
      return PAGE_RECORDINGS.seasonNow.body;
  }
};

const unsupported = (scenario: ContractScenario, call: ContractCall): Error =>
  new Error(`no ${scenario} answer for ${call.method}`);

// the json body of a scenario answered with a 2xx
const bodyOf = (scenario: ContractScenario, call: ContractCall): JsonObject => {
  const kind = kindOf(call);
  if (call.method === 'getGenres') {
    if (scenario === 'genres') {
      return GENRE_RECORDINGS[call.kind].body;
    }
    if (scenario === 'malformed') {
      // a genre without its name
      return { data: [{ mal_id: 1 }] };
    }
    throw unsupported(scenario, call);
  }
  if (call.method === 'getDetail') {
    const id = DETAIL_IDS[call.kind];
    switch (scenario) {
      case 'detail':
        return (
          call.kind === 'anime' ? DETAIL_RECORDINGS.anime52991 : DETAIL_RECORDINGS.manga121496
        ).body;
      case 'adult-genre':
      case 'adult-rating':
        return buildJikanDetail(itemOf(kind, { mal_id: id, ...adultOverrides(scenario, kind) }));
      case 'malformed':
        return buildJikanDetail(withoutKeys(itemOf(kind, { mal_id: id }), 'explicit_genres'));
      default:
        throw unsupported(scenario, call);
    }
  }
  switch (scenario) {
    case 'page':
      return recordedPageOf(call);
    case 'empty-page':
      return PAGE_RECORDINGS.searchEmpty.body;
    case 'adult-genre':
    case 'adult-rating':
      return buildJikanPage(
        SYNTHETIC_IDS.map((id) => itemOf(kind, { mal_id: id, ...adultOverrides(scenario, kind) })),
      );
    case 'malformed':
      return buildJikanPage([withoutKeys(itemOf(kind, {}), 'explicit_genres')]);
    default:
      throw unsupported(scenario, call);
  }
};

const answerOf = (scenario: ContractScenario, call: ContractCall): JikanAnswer => {
  switch (scenario) {
    case 'server-error':
      return () => jikanError(HTTP_SERVICE_UNAVAILABLE, 'Service Unavailable');
    case 'rate-limited':
      return () => jikanError(HTTP_TOO_MANY_REQUESTS, 'Too Many Requests');
    case 'hanging':
      return neverAnswer;
    default:
      return jsonAnswer(bodyOf(scenario, call));
  }
};

// the harness of one instance, and the reset of its request record before each test
const harnessOf = (
  name: string,
  instance: JikanInstance,
): { readonly harness: CatalogProviderHarness<JikanRequest>; readonly reset: () => void } => {
  let recorded: readonly JikanRequest[] = [];
  const harness: CatalogProviderHarness<JikanRequest> = {
    name,
    // random() = 0: a fixed backoff jitter
    createProvider: () => createJikanCatalogProvider(instance, { random: () => 0 }),
    serve: (scenario, call) => {
      const { handler, requests } = jikanHandler(
        pathOf(call),
        answerOf(scenario, call),
        instance.baseUrl,
      );
      server.use(handler);
      recorded = requests;
    },
    requests: () => recorded,
    sendsContentFilter: (request) => sendsContentFilter(request.url),
    detailKey: (kind) => ({ namespace: JIKAN_NAMESPACE, kind, externalId: DETAIL_IDS[kind] }),
  };
  return {
    harness,
    reset: () => {
      recorded = [];
    },
  };
};

describe('the content filter predicate of the jikan harness', () => {
  it.each(['sfw', 'sfw-strict', 'rating', 'unapproved', 'continuing'])(
    'detects %s as a query parameter name',
    (name) => {
      expect(sendsContentFilter(`${SELF_HOSTED_BASE}/anime?q=x&${name}&page=1`)).toBe(true);
      expect(sendsContentFilter(`${SELF_HOSTED_BASE}/anime?${name}=true`)).toBe(true);
    },
  );

  it('ignores the names as values and in the path', () => {
    expect(sendsContentFilter(`${SELF_HOSTED_BASE}/anime?q=rating&order_by=sfw&page=1`)).toBe(
      false,
    );
    expect(sendsContentFilter(`${SELF_HOSTED_BASE}/rating/sfw`)).toBe(false);
  });
});

// each run answers on its own instance base only: a request to another base is unhandled by msw
// and fails the test
for (const [name, instance] of [
  ['jikan on tenrai', TENRAI_INSTANCE],
  ['jikan self-hosted', selfHostedJikanInstance(SELF_HOSTED_BASE)],
] as const) {
  const { harness, reset } = harnessOf(name, instance);
  beforeEach(reset);
  describeCatalogProviderContract(harness);
}
