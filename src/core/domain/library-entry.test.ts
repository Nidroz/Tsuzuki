import { describe, expect, it, jest } from '@jest/globals';

import {
  DEFAULT_LIBRARY_STATUS,
  LIBRARY_STATUSES,
  NOTES_MAX_LENGTH,
  SCORE_MAX,
  SCORE_MIN,
  createLibraryEntry,
  favoriteMedia,
  isLibraryStatus,
  isValidNotes,
  isValidScore,
  libraryWriteContextAt,
  setFavorite,
  updateLibraryEntry,
  type LibraryEntry,
  type LibraryMediaSnapshot,
  type LibraryWriteContext,
} from './library-entry';
import type { MediaKey } from './media';

const KEY: MediaKey = { namespace: 'mal', kind: 'anime', externalId: 52991 };

const MEDIA: LibraryMediaSnapshot = {
  title: 'Sousou no Frieren',
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg',
  format: 'tv',
  totalUnits: 28,
  isAdult: false,
};

const CREATED: LibraryWriteContext = { now: '2026-01-05T10:00:00.000Z', today: '2026-01-05' };
const CTX: LibraryWriteContext = { now: '2026-02-10T20:30:00.000Z', today: '2026-02-10' };

const entryWith = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  ...createLibraryEntry(KEY, MEDIA, CREATED),
  ...overrides,
});

describe('LIBRARY_STATUSES', () => {
  it('lists the statuses in the library_status enum order', () => {
    expect(LIBRARY_STATUSES).toStrictEqual([
      'current',
      'planned',
      'completed',
      'paused',
      'dropped',
    ]);
  });

  it('defaults a new entry to planned', () => {
    expect(DEFAULT_LIBRARY_STATUS).toBe('planned');
  });
});

describe('isLibraryStatus', () => {
  it.each(LIBRARY_STATUSES)('accepts %s', (status) => {
    expect(isLibraryStatus(status)).toBe(true);
  });

  it.each(['Planned', 'watching', 'current ', ''])('rejects %p', (value) => {
    expect(isLibraryStatus(value)).toBe(false);
  });
});

describe('libraryWriteContextAt', () => {
  it('stamps now with the ISO timestamp of the date', () => {
    const date = new Date(2026, 0, 5, 23, 59);
    expect(libraryWriteContextAt(date).now).toBe(date.toISOString());
  });

  it('zero-pads the local month and day', () => {
    expect(libraryWriteContextAt(new Date(2026, 0, 5, 23, 59)).today).toBe('2026-01-05');
  });

  it('uses the local calendar day at midnight and at the end of the year', () => {
    expect(libraryWriteContextAt(new Date(2026, 2, 9, 0, 0)).today).toBe('2026-03-09');
    expect(libraryWriteContextAt(new Date(2025, 11, 31, 23, 59)).today).toBe('2025-12-31');
  });

  it('dates the write with the local day when it differs from the UTC day', () => {
    // a device east of UTC: already january 6 locally, still january 5 in UTC
    const date = new Date('2026-01-05T23:30:00.000Z');
    jest.spyOn(date, 'getDate').mockReturnValue(6);
    expect(libraryWriteContextAt(date)).toStrictEqual({
      now: '2026-01-05T23:30:00.000Z',
      today: '2026-01-06',
    });
  });

  it('throws a RangeError on an invalid date', () => {
    expect(() => libraryWriteContextAt(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('createLibraryEntry', () => {
  it('adds a planned entry with progress 0, no score, notes or dates (FR-10)', () => {
    expect(createLibraryEntry(KEY, MEDIA, CTX)).toStrictEqual({
      key: KEY,
      media: MEDIA,
      status: 'planned',
      progress: 0,
      score: null,
      notes: null,
      isFavorite: false,
      startedAt: null,
      finishedAt: null,
      createdAt: CTX.now,
      updatedAt: CTX.now,
    });
  });
});

describe('BR-05 favoriteMedia', () => {
  it('adds a media not in the library as a planned favorite', () => {
    expect(favoriteMedia(null, KEY, MEDIA, CTX)).toStrictEqual({
      ...createLibraryEntry(KEY, MEDIA, CTX),
      isFavorite: true,
    });
  });

  it('only marks an existing entry as a favorite, keeping its status, progress and snapshot', () => {
    const entry = entryWith({ status: 'paused', progress: 7, startedAt: '2026-01-06' });
    const otherMedia: LibraryMediaSnapshot = { ...MEDIA, title: 'Frieren', totalUnits: null };
    expect(favoriteMedia(entry, KEY, otherMedia, CTX)).toStrictEqual({
      ...entry,
      isFavorite: true,
      updatedAt: CTX.now,
    });
  });

  it('is a no-op on an entry that is already a favorite', () => {
    const entry = entryWith({ isFavorite: true });
    expect(favoriteMedia(entry, KEY, MEDIA, CTX)).toBe(entry);
  });
});

describe('BR-05 setFavorite', () => {
  it('unfavoriting keeps the entry in the library', () => {
    const entry = entryWith({ isFavorite: true, status: 'current', progress: 3 });
    expect(setFavorite(entry, false, CTX)).toStrictEqual({
      ...entry,
      isFavorite: false,
      updatedAt: CTX.now,
    });
  });

  it('is a no-op when the value is unchanged', () => {
    const entry = entryWith();
    expect(setFavorite(entry, false, CTX)).toBe(entry);
  });
});

describe('BR-09 updateLibraryEntry', () => {
  it('returns a new entry with updatedAt = ctx.now when a value changes', () => {
    const entry = entryWith();
    const next = updateLibraryEntry(entry, { notes: 'rewatch', score: 9 }, CTX);
    expect(next).not.toBe(entry);
    expect(next).toStrictEqual({ ...entry, notes: 'rewatch', score: 9, updatedAt: CTX.now });
  });

  it('returns the same reference when every value is unchanged', () => {
    const entry = entryWith({ status: 'current', progress: 4 });
    expect(updateLibraryEntry(entry, { status: 'current', progress: 4 }, CTX)).toBe(entry);
    expect(updateLibraryEntry(entry, {}, CTX)).toBe(entry);
  });

  it('keeps the key, the snapshot and createdAt', () => {
    const entry = entryWith();
    const next = updateLibraryEntry(entry, { status: 'dropped' }, CTX);
    expect(next.key).toBe(entry.key);
    expect(next.media).toBe(entry.media);
    expect(next.createdAt).toBe(CREATED.now);
  });

  it('ignores the fields of a wider object that are not changeable', () => {
    const entry = entryWith();
    const other: LibraryEntry = {
      ...createLibraryEntry({ ...KEY, externalId: 1 }, { ...MEDIA, title: 'Other' }, CTX),
      notes: 'other',
    };
    const next = updateLibraryEntry(entry, other, CTX);
    expect(next).toStrictEqual({ ...entry, notes: 'other', updatedAt: CTX.now });
    expect(updateLibraryEntry(entry, { ...other, notes: null }, CTX)).toBe(entry);
  });
});

describe('BR-07 isValidScore', () => {
  it('bounds the score to 1..10', () => {
    expect(SCORE_MIN).toBe(1);
    expect(SCORE_MAX).toBe(10);
  });

  it.each<[string, number | null]>([
    ['no score', null],
    ['the minimum', SCORE_MIN],
    ['the maximum', SCORE_MAX],
    ['a middle score', 7],
  ])('accepts %s', (_label, score) => {
    expect(isValidScore(score)).toBe(true);
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['one past the maximum', SCORE_MAX + 1],
    ['a fraction', 5.5],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['a negative score', -1],
  ])('rejects %s', (_label, score) => {
    expect(isValidScore(score)).toBe(false);
  });
});

describe('BR-07 isValidNotes', () => {
  // the emoji U+1F600: two utf-16 units, one code point
  const ASTRAL = '\u{1F600}';

  it('bounds notes to 2000 code points', () => {
    expect(NOTES_MAX_LENGTH).toBe(2000);
  });

  it.each<[string, string | null]>([
    ['no notes', null],
    ['empty notes', ''],
    ['short notes', 'rewatch the finale'],
    ['exactly 2000 ascii characters', 'a'.repeat(NOTES_MAX_LENGTH)],
    ['exactly 2000 astral code points (4000 utf-16 units)', ASTRAL.repeat(NOTES_MAX_LENGTH)],
  ])('accepts %s', (_label, notes) => {
    expect(isValidNotes(notes)).toBe(true);
  });

  it.each<[string, string]>([
    ['2001 code points', 'a'.repeat(NOTES_MAX_LENGTH + 1)],
    ['2001 astral code points', ASTRAL.repeat(NOTES_MAX_LENGTH + 1)],
    ['a NUL', 'before\u0000after'],
    ['a lone high surrogate', 'note \uD83D'],
    ['a lone low surrogate', '\uDE00 note'],
  ])('rejects %s', (_label, notes) => {
    expect(isValidNotes(notes)).toBe(false);
  });
});
