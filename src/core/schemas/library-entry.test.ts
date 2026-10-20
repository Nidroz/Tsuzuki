import { describe, expect, it } from '@jest/globals';

import {
  ENTRY_KEY,
  SNAPSHOT,
  entryOf,
  entryWithMedia,
} from '../../../test/core/library-entry-fixtures';
import { NOTES_MAX_LENGTH, SCORE_MAX, SCORE_MIN, type LibraryEntry } from '../domain/library-entry';
import { PROGRESS_MAX } from '../domain/library-progress';
import { EXTERNAL_ID_MAX } from '../domain/media';
import { libraryEntrySchema } from './library-entry';

// the emoji U+1F600: two utf-16 units, one code point
const ASTRAL = '\u{1F600}';

const accepts = (value: unknown): boolean => libraryEntrySchema.safeParse(value).success;

// `entry` with `field` set to `value`, a value the domain type may not allow
const withField = (field: string, value: unknown, entry: LibraryEntry = entryOf()): unknown => ({
  ...entry,
  [field]: value,
});

const withoutField = (field: keyof LibraryEntry): unknown =>
  Object.fromEntries(Object.entries(entryOf()).filter(([name]) => name !== field));

describe('libraryEntrySchema', () => {
  it('accepts a valid entry and outputs it unchanged', () => {
    const entry = entryOf();
    expect(libraryEntrySchema.parse(entry)).toStrictEqual(entry);
  });

  it('accepts a new planned entry with every optional value empty', () => {
    const entry = entryOf({
      status: 'planned',
      progress: 0,
      score: null,
      notes: null,
      startedAt: null,
      finishedAt: null,
      media: { ...SNAPSHOT, imageUrl: null, totalUnits: null },
    });
    expect(libraryEntrySchema.parse(entry)).toStrictEqual(entry);
  });

  it('normalizes the timestamps to the toISOString form', () => {
    const parsed = libraryEntrySchema.parse(
      entryOf({
        createdAt: '2026-01-05T12:00:00.987654+02:00',
        updatedAt: '2026-02-10T20:30:00.123456+00:00',
      }),
    );
    expect(parsed.createdAt).toBe('2026-01-05T10:00:00.987Z');
    expect(parsed.updatedAt).toBe('2026-02-10T20:30:00.123Z');
  });

  it('strips unknown fields, nested ones included', () => {
    const raw = {
      ...entryOf(),
      id: 'row-id',
      userId: 'owner',
      key: { ...ENTRY_KEY, instance: 'tenrai' },
      media: { ...SNAPSHOT, synopsis: 'text' },
    };
    expect(libraryEntrySchema.parse(raw)).toStrictEqual(entryOf());
  });

  it('accepts a progress above the snapshot total, like the database', () => {
    expect(accepts(entryOf({ progress: 40, media: { ...SNAPSHOT, totalUnits: 28 } }))).toBe(true);
  });

  it.each<[string, number]>([
    ['zero', 0],
    ['the bound', PROGRESS_MAX],
  ])('accepts a progress of %s', (_label, progress) => {
    expect(accepts(entryOf({ progress }))).toBe(true);
  });

  it.each<[string, number]>([
    ['-1', -1],
    ['one past the bound', PROGRESS_MAX + 1],
    ['a fraction', 2.5],
  ])('rejects a progress of %s', (_label, progress) => {
    expect(accepts(entryOf({ progress }))).toBe(false);
  });

  it.each<[string, number]>([
    ['1', 1],
    ['the bound', EXTERNAL_ID_MAX],
  ])('accepts an external id of %s', (_label, externalId) => {
    expect(accepts(entryOf({ key: { ...ENTRY_KEY, externalId } }))).toBe(true);
  });

  it.each<[string, unknown]>([
    ['zero', 0],
    ['one past the bound', EXTERNAL_ID_MAX + 1],
    ['a fraction', 1.5],
    ['a numeric string', '52991'],
  ])('rejects an external id of %s', (_label, externalId) => {
    expect(accepts(withField('key', { ...ENTRY_KEY, externalId }))).toBe(false);
  });

  it.each<[string, unknown]>([
    ['an unknown namespace', { ...ENTRY_KEY, namespace: 'anilist' }],
    ['an unknown kind', { ...ENTRY_KEY, kind: 'novel' }],
    ['a capitalized kind', { ...ENTRY_KEY, kind: 'Anime' }],
    ['a missing key', undefined],
  ])('rejects %s', (_label, key) => {
    expect(accepts(withField('key', key))).toBe(false);
  });

  it.each([['Watching'], ['completed '], [null]])('rejects the status %p', (status) => {
    expect(accepts(withField('status', status))).toBe(false);
  });

  it.each<[string, number | null]>([
    ['no score', null],
    ['the minimum', SCORE_MIN],
    ['the maximum', SCORE_MAX],
  ])('BR-07: accepts %s', (_label, score) => {
    expect(accepts(entryOf({ score }))).toBe(true);
  });

  it.each<[string, unknown]>([
    ['0', 0],
    ['11', SCORE_MAX + 1],
    ['5.5', 5.5],
    ['NaN', Number.NaN],
    ['a string', '9'],
  ])('BR-07: rejects a score of %s', (_label, score) => {
    expect(accepts(withField('score', score))).toBe(false);
  });

  it.each<[string, string | null]>([
    ['no notes', null],
    ['empty notes', ''],
    ['2000 astral code points', ASTRAL.repeat(NOTES_MAX_LENGTH)],
  ])('BR-07: accepts %s', (_label, notes) => {
    expect(accepts(entryOf({ notes }))).toBe(true);
  });

  it.each<[string, string]>([
    ['2001 code points', 'a'.repeat(NOTES_MAX_LENGTH + 1)],
    ['a NUL', 'a\u0000b'],
    ['a lone surrogate', 'a\uD83Db'],
  ])('BR-07: rejects notes with %s', (_label, notes) => {
    expect(accepts(entryOf({ notes }))).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a string', 'true'],
    ['a number', 1],
  ])('rejects isFavorite as %s', (_label, isFavorite) => {
    expect(accepts(withField('isFavorite', isFavorite))).toBe(false);
  });

  it.each([
    ['startedAt', '2025-02-29'],
    ['finishedAt', '2026-02-10T00:00:00Z'],
    ['createdAt', '2026-01-05'],
    ['updatedAt', '2026-02-10T20:30:00'],
    ['updatedAt', 1_770_755_400_000],
  ])('rejects %s = %p', (field, value) => {
    expect(accepts(withField(field, value))).toBe(false);
  });

  it.each<keyof LibraryEntry>(['media', 'status', 'notes', 'startedAt', 'createdAt', 'updatedAt'])(
    'rejects an entry without %s',
    (field) => {
      expect(accepts(withoutField(field))).toBe(false);
    },
  );

  it('rejects an entry whose snapshot is invalid', () => {
    expect(accepts(entryWithMedia({ title: '' }))).toBe(false);
    expect(accepts(entryWithMedia({ totalUnits: 0 }))).toBe(false);
  });

  it('reports issues that hold no title, notes or date', () => {
    const notes = 'private note\u0000';
    const title = 'T'.repeat(501);
    const result = libraryEntrySchema.safeParse(
      entryWithMedia({ title }, { notes, createdAt: '2026-02-30T00:00:00Z' }),
    );

    expect(result.success).toBe(false);
    const issues = JSON.stringify(result.error?.issues);
    expect(issues).not.toContain('private note');
    expect(issues).not.toContain('TTTT');
    expect(issues).not.toContain('2026-02-30');
  });
});
