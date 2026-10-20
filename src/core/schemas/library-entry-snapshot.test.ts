import { describe, expect, it } from '@jest/globals';

import { SNAPSHOT } from '../../../test/core/library-entry-fixtures';
import type { MediaDetail, MediaSummary } from '../catalog/catalog-provider';
import {
  MEDIA_IMAGE_URL_MAX_LENGTH,
  MEDIA_TITLE_MAX_LENGTH,
  POSTGRES_INTEGER_MAX,
  codePointLength,
  isStorableText,
} from '../domain/database-limits';
import { libraryMediaSnapshotSchema, toLibraryMediaSnapshot } from './library-entry';

// the emoji U+1F600: two utf-16 units, one code point
const ASTRAL = '\u{1F600}';
const NUL = '\u0000';
const LONE_HIGH = '\uD83D';
const LONE_LOW = '\uDE00';
const REPLACEMENT = '�';
const HTTPS = 'https://';

const accepts = (value: unknown): boolean => libraryMediaSnapshotSchema.safeParse(value).success;

// the snapshot with `field` set to `value`, a value the domain type may not allow
const withField = (field: string, value: unknown): unknown => ({ ...SNAPSHOT, [field]: value });

// an https url of exactly `length` characters
const urlOfLength = (length: number): string =>
  `${HTTPS}cdn.myanimelist.net/${'a'.repeat(length - `${HTTPS}cdn.myanimelist.net/`.length)}`;

// what `run` throws, undefined when it returns
const thrownBy = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
};

const SUMMARY: MediaSummary = {
  key: { namespace: 'mal', kind: 'anime', externalId: 52991 },
  title: SNAPSHOT.title,
  titleEnglish: 'Frieren: Beyond Journey’s End',
  imageUrl: SNAPSHOT.imageUrl,
  format: 'tv',
  status: 'finished',
  totalUnits: 28,
  score: 9.3,
  year: 2023,
  genres: [{ id: 2, name: 'Adventure' }],
  isAdult: false,
};

describe('libraryMediaSnapshotSchema', () => {
  it('accepts a valid snapshot and outputs it unchanged', () => {
    expect(libraryMediaSnapshotSchema.parse(SNAPSHOT)).toStrictEqual(SNAPSHOT);
  });

  it('strips unknown fields', () => {
    expect(libraryMediaSnapshotSchema.parse({ ...SNAPSHOT, synopsis: 'text' })).toStrictEqual(
      SNAPSHOT,
    );
  });

  it.each<[string, string]>([
    ['one character', 'A'],
    ['500 ascii characters', 'a'.repeat(MEDIA_TITLE_MAX_LENGTH)],
    ['500 astral code points (1000 utf-16 units)', ASTRAL.repeat(MEDIA_TITLE_MAX_LENGTH)],
  ])('accepts a title of %s', (_label, title) => {
    expect(accepts({ ...SNAPSHOT, title })).toBe(true);
  });

  it.each<[string, string]>([
    ['no character', ''],
    ['501 ascii characters', 'a'.repeat(MEDIA_TITLE_MAX_LENGTH + 1)],
    ['501 astral code points', ASTRAL.repeat(MEDIA_TITLE_MAX_LENGTH + 1)],
    ['a NUL', `Frieren${NUL}`],
    ['a lone surrogate', `Frieren${LONE_HIGH}`],
  ])('rejects a title of %s', (_label, title) => {
    expect(accepts({ ...SNAPSHOT, title })).toBe(false);
  });

  it.each<[string, string | null]>([
    ['no url', null],
    ['2048 characters', urlOfLength(MEDIA_IMAGE_URL_MAX_LENGTH)],
  ])('accepts an image url of %s', (_label, imageUrl) => {
    expect(accepts({ ...SNAPSHOT, imageUrl })).toBe(true);
  });

  it.each<[string, string]>([
    ['2049 characters', urlOfLength(MEDIA_IMAGE_URL_MAX_LENGTH + 1)],
    ['http', 'http://cdn.myanimelist.net/images/anime/1015/138006.jpg'],
    ['an uppercase scheme', 'HTTPS://cdn.myanimelist.net/images/anime/1015/138006.jpg'],
    ['a relative path', '/images/anime/1015/138006.jpg'],
    ['a NUL', `${HTTPS}cdn.myanimelist.net/a${NUL}.jpg`],
    ['a lone surrogate', `${HTTPS}cdn.myanimelist.net/a${LONE_LOW}.jpg`],
  ])('rejects an image url of %s', (_label, imageUrl) => {
    expect(accepts({ ...SNAPSHOT, imageUrl })).toBe(false);
  });

  it.each(['tv', 'light_novel', 'unknown'])('accepts the format %p', (format) => {
    expect(accepts(withField('format', format))).toBe(true);
  });

  it.each(['TV', 'series', '', null])('rejects the format %p', (format) => {
    expect(accepts(withField('format', format))).toBe(false);
  });

  it.each<[string, number | null]>([
    ['unknown', null],
    ['1', 1],
    ['the bound', POSTGRES_INTEGER_MAX],
  ])('accepts a total of %s', (_label, totalUnits) => {
    expect(accepts({ ...SNAPSHOT, totalUnits })).toBe(true);
  });

  it.each<[string, unknown]>([
    ['0', 0],
    ['one past the bound', POSTGRES_INTEGER_MAX + 1],
    ['a fraction', 12.5],
    ['a string', '28'],
  ])('rejects a total of %s', (_label, totalUnits) => {
    expect(accepts(withField('totalUnits', totalUnits))).toBe(false);
  });

  it('BR-06: requires isAdult, never defaulting it', () => {
    const withoutAdult = Object.fromEntries(
      Object.entries(SNAPSHOT).filter(([field]) => field !== 'isAdult'),
    );
    expect(accepts(withoutAdult)).toBe(false);
    expect(accepts(withField('isAdult', null))).toBe(false);
    expect(accepts(withField('isAdult', 'false'))).toBe(false);
  });
});

describe('toLibraryMediaSnapshot', () => {
  it('copies the snapshot fields of a summary', () => {
    expect(toLibraryMediaSnapshot(SUMMARY)).toStrictEqual(SNAPSHOT);
  });

  it.each([true, false])('BR-06: copies isAdult %p', (isAdult) => {
    expect(toLibraryMediaSnapshot({ ...SUMMARY, isAdult }).isAdult).toBe(isAdult);
  });

  it('takes a detail, which extends a summary', () => {
    const detail: MediaDetail = { ...SUMMARY, synopsis: 'A mage outlives.', titleNative: null };
    expect(toLibraryMediaSnapshot(detail)).toStrictEqual(SNAPSHOT);
  });

  it('keeps a null image url and an unknown total', () => {
    const snapshot = toLibraryMediaSnapshot({ ...SUMMARY, imageUrl: null, totalUnits: null });
    expect(snapshot.imageUrl).toBeNull();
    expect(snapshot.totalUnits).toBeNull();
  });

  it('cuts a long title of astral characters at 500 code points without splitting a pair', () => {
    const { title } = toLibraryMediaSnapshot({ ...SUMMARY, title: ASTRAL.repeat(600) });

    expect(title).toBe(ASTRAL.repeat(MEDIA_TITLE_MAX_LENGTH));
    expect(codePointLength(title)).toBe(MEDIA_TITLE_MAX_LENGTH);
    expect(isStorableText(title)).toBe(true);
  });

  it('cuts before a pair that would be the 501st code point', () => {
    const raw = `${'a'.repeat(MEDIA_TITLE_MAX_LENGTH)}${ASTRAL}`;
    expect(toLibraryMediaSnapshot({ ...SUMMARY, title: raw }).title).toBe(
      'a'.repeat(MEDIA_TITLE_MAX_LENGTH),
    );
  });

  it('keeps a pair that is the 500th code point', () => {
    const raw = `${'a'.repeat(MEDIA_TITLE_MAX_LENGTH - 1)}${ASTRAL}bc`;
    expect(toLibraryMediaSnapshot({ ...SUMMARY, title: raw }).title).toBe(
      `${'a'.repeat(MEDIA_TITLE_MAX_LENGTH - 1)}${ASTRAL}`,
    );
  });

  it('removes NUL and replaces lone surrogates before cutting', () => {
    const { title } = toLibraryMediaSnapshot({
      ...SUMMARY,
      title: `Fri${NUL}eren ${LONE_HIGH}${NUL}${LONE_LOW}`,
    });
    expect(title).toBe(`Frieren ${REPLACEMENT}${REPLACEMENT}`);
  });

  it('counts the cleaned title: removed NUL characters free room', () => {
    const raw = `${NUL.repeat(10)}${'a'.repeat(MEDIA_TITLE_MAX_LENGTH)}`;
    expect(toLibraryMediaSnapshot({ ...SUMMARY, title: raw }).title).toBe(
      'a'.repeat(MEDIA_TITLE_MAX_LENGTH),
    );
  });

  it.each<[string, string]>([
    ['empty', ''],
    ['only NUL characters', `${NUL}${NUL}`],
  ])('throws a RangeError without the title when the title is %s', (_label, title) => {
    expect(() => toLibraryMediaSnapshot({ ...SUMMARY, title })).toThrow(RangeError);
  });

  it('throws a RangeError whose message holds no value', () => {
    const summary: MediaSummary = {
      ...SUMMARY,
      title: `Secret title${NUL}`,
      imageUrl: 'http://cdn.example/secret.jpg',
    };

    const error = thrownBy(() => toLibraryMediaSnapshot(summary));

    expect(error).toBeInstanceOf(RangeError);
    expect(String(error)).not.toMatch(/secret/i);
  });

  it.each<[string, Partial<MediaSummary>]>([
    ['a non-https image url', { imageUrl: 'http://cdn.myanimelist.net/a.jpg' }],
    ['a zero total', { totalUnits: 0 }],
  ])('throws a RangeError for %s', (_label, overrides) => {
    expect(() => toLibraryMediaSnapshot({ ...SUMMARY, ...overrides })).toThrow(RangeError);
  });
});
