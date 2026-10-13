import { describe, expect, it } from '@jest/globals';

import { CatalogResponseError } from '../../errors/catalog-errors';
import {
  buildJikanAnime,
  buildJikanGenres,
  buildJikanManga,
  buildJikanPage,
  genreRef,
  withoutKeys,
} from './__fixtures__/jikan-builders';
import { parseJikanGenres, parseJikanPage } from './jikan-mappers';

// the error thrown by `parse`, or null
const failureOf = (parse: () => unknown): unknown => {
  try {
    parse();
  } catch (error: unknown) {
    return error;
  }
  return null;
};

const titledAnime = (malId: number, title: string) =>
  buildJikanAnime({ mal_id: malId, titles: [{ type: 'Default', title }] });

// copies of id 101: clean, with Hentai only in explicit_genres, or rated Rx with clean genres
const COPY_OVERRIDES = {
  clean: {},
  hentai: { explicit_genres: [genreRef(12, 'Hentai')] },
  rx: { rating: 'Rx - Hentai' },
} as const;

type CopyContent = keyof typeof COPY_OVERRIDES;

const copyOf = (content: CopyContent, title: string) =>
  buildJikanAnime({
    mal_id: 101,
    titles: [{ type: 'Default', title }],
    ...COPY_OVERRIDES[content],
  });

describe('parseJikanPage', () => {
  it('maps the items and keeps the requested page', () => {
    const body = buildJikanPage([titledAnime(101, 'First'), titledAnime(102, 'Second')], {
      current_page: 9,
      last_visible_page: 7,
      has_next_page: true,
    });

    const page = parseJikanPage('anime', 3, body);

    expect(page.items.map((item) => [item.key, item.title])).toStrictEqual([
      [{ kind: 'anime', malId: 101 }, 'First'],
      [{ kind: 'anime', malId: 102 }, 'Second'],
    ]);
    expect(page).toMatchObject({ page: 3, lastPage: 7, hasNextPage: true });
  });

  it('keeps the first item of an id repeated within the page', () => {
    const body = buildJikanPage([
      titledAnime(101, 'First'),
      titledAnime(102, 'Second'),
      titledAnime(101, 'Repeated'),
    ]);

    const page = parseJikanPage('anime', 1, body);

    expect(page.items.map((item) => item.title)).toStrictEqual(['First', 'Second']);
  });

  it.each<[string, CopyContent, CopyContent, boolean]>([
    ['a clean first copy and an adult second copy', 'clean', 'hentai', true],
    ['an adult first copy and a clean second copy', 'rx', 'clean', true],
    ['two clean copies', 'clean', 'clean', false],
  ])('flags a repeated id with %s as adult: %p', (_case, first, second, isAdult) => {
    const body = buildJikanPage([
      copyOf(first, 'First'),
      titledAnime(102, 'Other'),
      copyOf(second, 'Repeated'),
    ]);

    const page = parseJikanPage('anime', 1, body);

    expect(page.items.map((item) => [item.key.malId, item.title, item.isAdult])).toStrictEqual([
      [101, 'First', isAdult],
      [102, 'Other', false],
    ]);
  });

  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [40, 40],
  ])('reads a last visible page of %p as %p', (lastVisiblePage, lastPage) => {
    const body = buildJikanPage([], { last_visible_page: lastVisiblePage });
    expect(parseJikanPage('manga', 1, body)).toStrictEqual({
      items: [],
      page: 1,
      lastPage,
      hasNextPage: false,
    });
  });

  it('parses a manga page with the manga schema', () => {
    const page = parseJikanPage('manga', 1, buildJikanPage([buildJikanManga()]));
    expect(page.items.map((item) => [item.key.kind, item.format])).toStrictEqual([
      ['manga', 'manga'],
    ]);
    // an anime status is not a manga status
    expect(
      failureOf(() => parseJikanPage('manga', 1, buildJikanPage([buildJikanAnime()]))),
    ).toBeInstanceOf(CatalogResponseError);
  });

  it('fails the whole page for one malformed item', () => {
    const body = buildJikanPage([buildJikanAnime(), buildJikanAnime({ mal_id: 0 })]);
    expect(failureOf(() => parseJikanPage('anime', 1, body))).toBeInstanceOf(CatalogResponseError);
  });

  it.each([
    ['no data', withoutKeys(buildJikanPage([]), 'data')],
    ['data that is not an array', { ...buildJikanPage([]), data: { 0: buildJikanAnime() } }],
    ['no pagination', withoutKeys(buildJikanPage([]), 'pagination')],
    ['a text last page', buildJikanPage([], { last_visible_page: '2' })],
    ['a fractional last page', buildJikanPage([], { last_visible_page: 1.5 })],
    ['no has_next_page', { data: [], pagination: { last_visible_page: 1 } }],
    ['a body that is not an object', 'not json'],
  ])('fails a response with %s', (_case, body) => {
    expect(failureOf(() => parseJikanPage('anime', 1, body))).toBeInstanceOf(CatalogResponseError);
  });
});

describe('parseJikanGenres', () => {
  it('lists every genre once, in the provider order', () => {
    const body = buildJikanGenres([
      [1, 'Action'],
      [12, 'Hentai'],
      [4, 'Comedy'],
      [1, 'Action'],
    ]);
    expect(parseJikanGenres(body)).toStrictEqual([
      { id: 1, name: 'Action' },
      { id: 12, name: 'Hentai' },
      { id: 4, name: 'Comedy' },
    ]);
  });

  it.each([
    ['no data', {}],
    ['a genre with id 0', { data: [{ mal_id: 0, name: 'Action' }] }],
    ['a genre without a name', { data: [{ mal_id: 1 }] }],
    ['a body that is not an object', null],
  ])('fails a response with %s', (_case, body) => {
    expect(failureOf(() => parseJikanGenres(body))).toBeInstanceOf(CatalogResponseError);
  });
});
