import { describe, expect, it } from '@jest/globals';

import {
  buildJikanAnime,
  buildJikanDetail,
  buildJikanManga,
  buildJikanPage,
  withoutKeys,
} from './__fixtures__/jikan-builders';
import { parseJikanDetail, parseJikanPage } from './jikan-mappers';

// the two covers of an item: the full-size one (imageUrl, the detail) and the list row one
// (thumbnailUrl), each the first candidate on the image allowlist

const CDN = 'https://cdn.myanimelist.net';
const OTHER_HOST = 'https://images.example';
const ANIME_KEY = { namespace: 'mal', kind: 'anime', externalId: 101 } as const;
const PATH = '/images/anime/1/101';

const detailWith = (images: unknown) =>
  parseJikanDetail(ANIME_KEY, buildJikanDetail(buildJikanAnime({ images })));

const coversOf = ({ imageUrl, thumbnailUrl }: { imageUrl: unknown; thumbnailUrl: unknown }) => ({
  imageUrl,
  thumbnailUrl,
});

// a jpg or webp variant, both urls under `base`
const variant = (base: string, extension: 'jpg' | 'webp') => ({
  image_url: `${base}${PATH}.${extension}`,
  small_image_url: `${base}${PATH}t.${extension}`,
  large_image_url: `${base}${PATH}l.${extension}`,
});

describe('the full-size cover', () => {
  it('prefers the large webp, then the large jpg, then the jpg', () => {
    const webp = { image_url: `${CDN}${PATH}.webp`, large_image_url: `${CDN}/w.webp` };
    expect(detailWith({ jpg: variant(CDN, 'jpg'), webp }).imageUrl).toBe(`${CDN}/w.webp`);
    expect(
      detailWith({ jpg: variant(CDN, 'jpg'), webp: variant(OTHER_HOST, 'webp') }).imageUrl,
    ).toBe(`${CDN}${PATH}l.jpg`);
    expect(
      detailWith({
        jpg: { ...variant(CDN, 'jpg'), large_image_url: `${OTHER_HOST}/x.jpg` },
        webp: { large_image_url: null },
      }).imageUrl,
    ).toBe(`${CDN}${PATH}.jpg`);
  });
});

describe('the list row cover', () => {
  it('takes the medium webp image of a summary, the detail keeping the large one', () => {
    const page = parseJikanPage('anime', 1, buildJikanPage([buildJikanAnime()]));

    expect(page.items.map(coversOf)).toStrictEqual([
      { imageUrl: `${CDN}${PATH}l.webp`, thumbnailUrl: `${CDN}${PATH}.webp` },
    ]);
  });

  it.each([
    [
      'the medium jpg without a medium webp',
      { jpg: variant(CDN, 'jpg'), webp: { ...variant(CDN, 'webp'), image_url: null } },
      `${CDN}${PATH}.jpg`,
    ],
    [
      'the large webp without any medium image',
      {
        jpg: { ...variant(CDN, 'jpg'), image_url: null },
        webp: { large_image_url: `${CDN}/w.webp` },
      },
      `${CDN}/w.webp`,
    ],
    [
      'the large jpg when it is the only image',
      { jpg: { large_image_url: `${CDN}${PATH}l.jpg` }, webp: null },
      `${CDN}${PATH}l.jpg`,
    ],
    [
      'the medium jpg after a medium webp on another host',
      { jpg: variant(CDN, 'jpg'), webp: variant(OTHER_HOST, 'webp') },
      `${CDN}${PATH}.jpg`,
    ],
    [
      'the medium jpg of a response whose webp variant is malformed',
      { jpg: variant(CDN, 'jpg'), webp: 'x' },
      `${CDN}${PATH}.jpg`,
    ],
  ])('falls back to %s', (_case, images, thumbnailUrl) => {
    expect(detailWith(images).thumbnailUrl).toBe(thumbnailUrl);
  });

  it('never takes the small image', () => {
    const images = { jpg: { small_image_url: `${CDN}${PATH}t.jpg` }, webp: variant(CDN, 'webp') };
    expect(detailWith(images).thumbnailUrl).toBe(`${CDN}${PATH}.webp`);
  });
});

describe('no cover', () => {
  it.each([
    ['every candidate on another host', { jpg: variant(OTHER_HOST, 'jpg'), webp: null }],
    ['every candidate over http', { jpg: variant('http://cdn.myanimelist.net', 'jpg') }],
    ['only a small image', { jpg: { small_image_url: `${CDN}${PATH}t.jpg` } }],
    ['malformed variants', { jpg: 'x', webp: [] }],
    ['images set to null', null],
    ['images that are not an object', 'x'],
  ])('with %s: both covers are null and the item is kept', (_case, images) => {
    const detail = detailWith(images);

    expect(detail.key).toStrictEqual(ANIME_KEY);
    expect(coversOf(detail)).toStrictEqual({ imageUrl: null, thumbnailUrl: null });
  });

  it('without an images key', () => {
    const body = buildJikanDetail(withoutKeys(buildJikanManga(), 'images'));
    const detail = parseJikanDetail({ namespace: 'mal', kind: 'manga', externalId: 201 }, body);

    expect(coversOf(detail)).toStrictEqual({ imageUrl: null, thumbnailUrl: null });
  });
});
