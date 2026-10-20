// valid library entries for the schema tests and the library repository contract
// (library-repository-contract.ts): within the database limits, timestamps already in the
// Date#toISOString form. built from the domain types only
import type { LibraryEntry, LibraryMediaSnapshot } from '@core/domain/library-entry';
import type { MediaKey, MediaKind } from '@core/domain/media';

export const ENTRY_CREATED_AT = '2026-01-05T10:00:00.000Z';
export const ENTRY_UPDATED_AT = '2026-02-10T20:30:00.000Z';

/** the title of SNAPSHOT and the notes of entryOf: never in an error or a report. */
export const TITLE_TEXT = 'Sousou no Frieren';
export const NOTES_TEXT = 'rewatch the finale';

export const SNAPSHOT: LibraryMediaSnapshot = {
  title: TITLE_TEXT,
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg',
  format: 'tv',
  totalUnits: 28,
  isAdult: false,
};

/** the key of a mal media. */
export const keyOf = (kind: MediaKind, externalId: number): MediaKey => ({
  namespace: 'mal',
  kind,
  externalId,
});

export const ENTRY_KEY = keyOf('anime', 52991);

/** a valid current entry of ENTRY_KEY with a score and notes, with `overrides` applied. */
export const entryOf = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
  key: ENTRY_KEY,
  media: SNAPSHOT,
  status: 'current',
  progress: 12,
  score: 9,
  notes: NOTES_TEXT,
  isFavorite: false,
  startedAt: '2026-01-06',
  finishedAt: null,
  createdAt: ENTRY_CREATED_AT,
  updatedAt: ENTRY_UPDATED_AT,
  ...overrides,
});

/** entryOf with the snapshot fields of `media` replaced. */
export const entryWithMedia = (
  media: Partial<LibraryMediaSnapshot>,
  overrides: Partial<LibraryEntry> = {},
): LibraryEntry => entryOf({ ...overrides, media: { ...SNAPSHOT, ...media } });
