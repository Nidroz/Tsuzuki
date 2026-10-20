// the cases and helpers of the library repository contract suite (library-repository-contract.ts).
// implementation-neutral: the domain and the repository interface only
import { MEDIA_TITLE_MAX_LENGTH } from '@core/domain/database-limits';
import { NOTES_MAX_LENGTH, SCORE_MAX, type LibraryEntry } from '@core/domain/library-entry';
import { MEDIA_ID_NAMESPACES, MEDIA_KINDS, type MediaKey } from '@core/domain/media';
import type { LibraryRepository } from '@core/repositories/library-repository';

import {
  ENTRY_KEY,
  NOTES_TEXT,
  TITLE_TEXT,
  entryOf,
  entryWithMedia,
} from './library-entry-fixtures';

/** the Date#toISOString form of every stored timestamp. */
export const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface InvalidEntryCase {
  readonly label: string;
  readonly entry: LibraryEntry;
}

/**
 * entries of ENTRY_KEY outside the database limits whatever their key; each keeps TITLE_TEXT in
 * its title and NOTES_TEXT in its notes, so an error can be checked for them.
 */
export const INVALID_ENTRIES: readonly InvalidEntryCase[] = [
  { label: 'a score of 11 (BR-07)', entry: entryOf({ score: SCORE_MAX + 1 }) },
  { label: 'a score of 5.5 (BR-07)', entry: entryOf({ score: 5.5 }) },
  {
    label: 'notes over the limit (BR-07)',
    entry: entryOf({ notes: `${NOTES_TEXT}${'x'.repeat(NOTES_MAX_LENGTH)}` }),
  },
  { label: 'notes with a NUL (BR-07)', entry: entryOf({ notes: `${NOTES_TEXT}\u0000` }) },
  {
    label: 'a title over the limit',
    entry: entryWithMedia({ title: `${TITLE_TEXT}${'x'.repeat(MEDIA_TITLE_MAX_LENGTH)}` }),
  },
  { label: 'a negative progress', entry: entryOf({ progress: -1 }) },
  { label: 'an updatedAt without offset', entry: entryOf({ updatedAt: '2026-02-10T20:30:00' }) },
];

/** valid entries but for their key. */
export const INVALID_KEYS: readonly InvalidEntryCase[] = [
  { label: 'an external id of 0', entry: entryOf({ key: { ...ENTRY_KEY, externalId: 0 } }) },
  { label: 'a fractional external id', entry: entryOf({ key: { ...ENTRY_KEY, externalId: 1.5 } }) },
];

/** the reason `promise` rejects with; throws when it resolves. */
export const failureOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
};

/** saves `entries` one after another, resolving to what each save resolved to. */
export const saveAll = async (
  repository: LibraryRepository,
  entries: readonly LibraryEntry[],
): Promise<LibraryEntry[]> => {
  const stored: LibraryEntry[] = [];
  for (const entry of entries) {
    stored.push(await repository.save(entry));
  }
  return stored;
};

// the reference key order, written apart from any implementation: namespace, kind (the enum
// orders), then externalId
const keyRank = (key: MediaKey): readonly number[] => [
  MEDIA_ID_NAMESPACES.indexOf(key.namespace),
  MEDIA_KINDS.indexOf(key.kind),
  key.externalId,
];

const compareRanks = (a: readonly number[], b: readonly number[]): number => {
  for (const [index, value] of a.entries()) {
    const other = b[index] ?? 0;
    if (value !== other) {
      return value - other;
    }
  }
  return 0;
};

/** `entries` in the LibraryRepository list order: updatedAt descending, then key ascending. */
export const inListOrder = (entries: readonly LibraryEntry[]): LibraryEntry[] =>
  [...entries].sort((a, b) => {
    const byTime = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return byTime === 0 ? compareRanks(keyRank(a.key), keyRank(b.key)) : byTime;
  });
