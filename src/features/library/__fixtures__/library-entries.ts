// a small library for the library screen tests: an entry of each status but paused and dropped,
// and an adult one, their covers on the fake catalog provider's image host
import { FAKE_IMAGE_HOSTS } from '@core/catalog/__fixtures__/fake-catalog-provider';
import type { LibraryEntry, LibraryMediaSnapshot } from '@core/domain/library-entry';
import type { MediaKind } from '@core/domain/media';

const coverOn = (name: string): string => `https://${FAKE_IMAGE_HOSTS.join('')}/${name}.jpg`;

/** a cover of a host the fake catalog provider does not serve images from */
export const FOREIGN_COVER = 'https://cdn.myanimelist.net/images/anime/1015/138006.jpg';

const CREATED_AT = '2026-01-05T10:00:00.000Z';

interface EntrySpec {
  readonly kind: MediaKind;
  readonly externalId: number;
  readonly media: Pick<LibraryMediaSnapshot, 'title' | 'format' | 'totalUnits'> &
    Partial<LibraryMediaSnapshot>;
  readonly entry: Pick<LibraryEntry, 'status' | 'progress' | 'score' | 'updatedAt'> &
    Partial<LibraryEntry>;
}

// a valid entry of the mal namespace: no notes, no dates, a cover named after its id
const libraryEntry = ({ kind, externalId, media, entry }: EntrySpec): LibraryEntry => ({
  key: { namespace: 'mal', kind, externalId },
  media: { imageUrl: coverOn(String(externalId)), isAdult: false, ...media },
  notes: null,
  isFavorite: false,
  startedAt: null,
  finishedAt: null,
  createdAt: CREATED_AT,
  ...entry,
});

/** an anime being watched, 12 of 28 episodes, scored 9; the last change of the library */
export const FRIEREN = libraryEntry({
  kind: 'anime',
  externalId: 52991,
  media: { title: 'Sousou no Frieren', format: 'tv', totalUnits: 28 },
  entry: { status: 'current', progress: 12, score: 9, updatedAt: '2026-03-05T10:00:00.000Z' },
});

/** a manga being read, its total unknown, without a score */
export const BERSERK = libraryEntry({
  kind: 'manga',
  externalId: 2,
  media: { title: 'Berserk', format: 'manga', totalUnits: null },
  entry: { status: 'current', progress: 364, score: null, updatedAt: '2026-03-04T10:00:00.000Z' },
});

/** a planned anime, scored 8 */
export const MONSTER = libraryEntry({
  kind: 'anime',
  externalId: 19,
  media: { title: 'Monster', format: 'tv', totalUnits: 74 },
  entry: { status: 'planned', progress: 0, score: 8, updatedAt: '2026-03-03T10:00:00.000Z' },
});

/** a completed anime at its known total: no `+1` (BR-01) */
export const MUSHISHI = libraryEntry({
  kind: 'anime',
  externalId: 457,
  media: { title: 'Mushishi', format: 'tv', totalUnits: 26 },
  entry: {
    status: 'completed',
    progress: 26,
    score: 10,
    finishedAt: '2026-03-02',
    updatedAt: '2026-03-02T10:00:00.000Z',
  },
});

/** an adult anime being watched, hidden while adult content is off (BR-06) */
export const ADULT = libraryEntry({
  kind: 'anime',
  externalId: 666,
  media: { title: 'Adult title', format: 'ova', totalUnits: 2, isAdult: true },
  entry: { status: 'current', progress: 1, score: null, updatedAt: '2026-03-01T10:00:00.000Z' },
});

/** the library of the tests, without the adult entry */
export const LIBRARY: readonly LibraryEntry[] = [FRIEREN, BERSERK, MONSTER, MUSHISHI];
