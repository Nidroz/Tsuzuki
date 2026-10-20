import { describe, expect, it } from '@jest/globals';

import { ENTRY_UPDATED_AT, entryOf } from '../../../test/core/library-entry-fixtures';
import { notesFromInput, setNotes, setScore } from './library-details';
import { NOTES_MAX_LENGTH, SCORE_MAX, SCORE_MIN, type LibraryWriteContext } from './library-entry';

const CTX: LibraryWriteContext = { now: '2026-03-01T08:15:00.000Z', today: '2026-03-01' };

describe('BR-07 setScore', () => {
  it.each<[string, number | null]>([
    ['the minimum', SCORE_MIN],
    ['the maximum', SCORE_MAX],
    ['no score', null],
  ])('sets %s with updatedAt = ctx.now', (_label, score) => {
    const entry = entryOf({ score: 5 });
    expect(setScore(entry, score, CTX)).toStrictEqual({ ...entry, score, updatedAt: CTX.now });
  });

  it('is a no-op (the same reference) when the score is unchanged', () => {
    const scored = entryOf({ score: 7 });
    const unscored = entryOf({ score: null });
    expect(setScore(scored, 7, CTX)).toBe(scored);
    expect(setScore(unscored, null, CTX)).toBe(unscored);
    expect(unscored.updatedAt).toBe(ENTRY_UPDATED_AT);
  });

  it.each([0, SCORE_MAX + 1, 1.5, Number.NaN])('throws a value-free RangeError for %p', (score) => {
    expect(() => setScore(entryOf(), score, CTX)).toThrow(
      new RangeError('score is outside the BR-07 range'),
    );
  });
});

describe('notesFromInput', () => {
  it.each(['', '   ', '\n\t ', ' '])('saves the blank text %p as no notes', (text) => {
    expect(notesFromInput(text)).toBeNull();
  });

  it.each(['rewatch', '  indented\n- line two\n', ' x '])('keeps %p exactly as typed', (text) => {
    expect(notesFromInput(text)).toBe(text);
  });
});

describe('BR-07 setNotes', () => {
  it.each<[string, string | null]>([
    ['short notes', 'rewatch the finale'],
    ['exactly 2000 code points', 'a'.repeat(NOTES_MAX_LENGTH)],
    ['no notes', null],
  ])('sets %s with updatedAt = ctx.now', (_label, notes) => {
    const entry = entryOf({ notes: 'before' });
    expect(setNotes(entry, notes, CTX)).toStrictEqual({ ...entry, notes, updatedAt: CTX.now });
  });

  it('is a no-op (the same reference) when the notes are unchanged', () => {
    const entry = entryOf({ notes: 'same' });
    expect(setNotes(entry, 'same', CTX)).toBe(entry);
  });

  it('stores the notes as given: callers apply notesFromInput', () => {
    expect(setNotes(entryOf(), '  ', CTX).notes).toBe('  ');
  });

  it.each<[string, string]>([
    ['2001 code points', 'a'.repeat(NOTES_MAX_LENGTH + 1)],
    ['a NUL', 'before\u0000after'],
    ['a lone surrogate', 'note \uD83D'],
  ])('throws a value-free RangeError for %s', (_label, notes) => {
    expect(() => setNotes(entryOf(), notes, CTX)).toThrow(
      new RangeError('notes are outside the BR-07 limits'),
    );
  });
});
