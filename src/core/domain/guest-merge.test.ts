import { describe, expect, it } from '@jest/globals';

import {
  SNAPSHOT,
  entryOf,
  entryWithMedia,
  keyOf,
} from '../../../test/core/library-entry-fixtures';
import { GUEST_MERGE_DECISIONS, guestMergeDecision, isSameLibraryEntry } from './guest-merge';
import type { LibraryEntry, LibraryMediaSnapshot } from './library-entry';

const ACCOUNT_UPDATED_AT = '2026-02-10T20:30:00.123Z';

describe('BR-08 guestMergeDecision', () => {
  it('lists the three decisions', () => {
    expect(GUEST_MERGE_DECISIONS).toStrictEqual(['insert', 'replace', 'keep']);
  });

  it('inserts when the account has no entry of the key', () => {
    expect(guestMergeDecision(ACCOUNT_UPDATED_AT, null)).toBe('insert');
  });

  it('replaces when the guest entry is newer (the most recent updated_at wins)', () => {
    expect(guestMergeDecision('2026-02-11T08:00:00.000Z', ACCOUNT_UPDATED_AT)).toBe('replace');
  });

  it('keeps the account copy when the guest entry is older', () => {
    expect(guestMergeDecision('2026-01-31T23:59:59.999Z', ACCOUNT_UPDATED_AT)).toBe('keep');
  });

  it('keeps the account copy on equal timestamps', () => {
    expect(guestMergeDecision(ACCOUNT_UPDATED_AT, ACCOUNT_UPDATED_AT)).toBe('keep');
  });

  it.each([
    { guest: '2026-02-10T20:30:00.124Z', decision: 'replace' },
    { guest: '2026-02-10T20:30:00.122Z', decision: 'keep' },
  ] as const)('decides $decision one millisecond apart ($guest)', ({ guest, decision }) => {
    expect(guestMergeDecision(guest, ACCOUNT_UPDATED_AT)).toBe(decision);
  });

  it('compares across a day, a month and a year boundary', () => {
    expect(guestMergeDecision('2027-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z')).toBe(
      'replace',
    );
    expect(guestMergeDecision('2026-09-30T23:59:59.999Z', '2026-10-01T00:00:00.000Z')).toBe('keep');
  });
});

describe('isSameLibraryEntry', () => {
  it('is true for an equal copy', () => {
    expect(isSameLibraryEntry(entryOf(), { ...entryOf(), media: { ...SNAPSHOT } })).toBe(true);
  });

  it.each<[string, Partial<LibraryEntry>]>([
    ['the key kind', { key: keyOf('manga', 52991) }],
    ['the key external id', { key: keyOf('anime', 52992) }],
    ['status', { status: 'completed' }],
    ['progress', { progress: 13 }],
    ['score', { score: null }],
    ['notes', { notes: 'another note' }],
    ['isFavorite', { isFavorite: true }],
    ['startedAt', { startedAt: null }],
    ['finishedAt', { finishedAt: '2026-03-01' }],
    ['createdAt', { createdAt: '2026-01-05T10:00:00.001Z' }],
    ['updatedAt', { updatedAt: '2026-02-10T20:30:00.001Z' }],
  ])('is false when %s differs', (_field, change) => {
    expect(isSameLibraryEntry(entryOf(), entryOf(change))).toBe(false);
  });

  it.each<[string, Partial<LibraryMediaSnapshot>]>([
    ['title', { title: 'Frieren' }],
    ['imageUrl', { imageUrl: null }],
    ['format', { format: 'movie' }],
    ['totalUnits', { totalUnits: 30 }],
    ['isAdult', { isAdult: true }],
  ])('is false when the snapshot %s differs', (_field, media) => {
    expect(isSameLibraryEntry(entryOf(), entryWithMedia(media))).toBe(false);
  });
});
