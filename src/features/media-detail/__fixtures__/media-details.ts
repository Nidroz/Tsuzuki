// media details for the media detail feature tests, from the recorded tenrai detail responses
// (src/core/catalog/jikan/__fixtures__/tenrai/, 2026-10-14) as the jikan adapter maps them; the
// adult detail is a synthetic placeholder, the recordings hold no adult title
import type { MediaDetail } from '@core/catalog/catalog-provider';

/** a finished anime with an english and a native title, a cover, a score, genres and a synopsis */
export const FRIEREN_DETAIL: MediaDetail = {
  key: { namespace: 'mal', kind: 'anime', externalId: 52991 },
  title: 'Sousou no Frieren',
  titleEnglish: "Frieren: Beyond Journey's End",
  titleNative: '葬送のフリーレン',
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1015/138006l.webp',
  format: 'tv',
  status: 'finished',
  totalUnits: 28,
  score: 9.24,
  year: 2023,
  genres: [
    { id: 2, name: 'Adventure' },
    { id: 46, name: 'Award Winning' },
    { id: 8, name: 'Drama' },
    { id: 10, name: 'Fantasy' },
  ],
  isAdult: false,
  synopsis: 'Placeholder synopsis.',
};

/** a manga still publishing: its english title is its title, its chapter count unknown */
export const BERSERK_DETAIL: MediaDetail = {
  key: { namespace: 'mal', kind: 'manga', externalId: 2 },
  title: 'Berserk',
  titleEnglish: 'Berserk',
  titleNative: 'ベルセルク',
  imageUrl: 'https://cdn.myanimelist.net/images/manga/1/157897l.webp',
  format: 'manga',
  status: 'ongoing',
  totalUnits: null,
  score: 9.46,
  year: 1989,
  genres: [
    { id: 1, name: 'Action' },
    { id: 2, name: 'Adventure' },
    { id: 14, name: 'Horror' },
  ],
  isAdult: false,
  synopsis: 'Placeholder synopsis.',
};

/** a finished manhwa with 201 chapters */
export const SOLO_LEVELING_DETAIL: MediaDetail = {
  key: { namespace: 'mal', kind: 'manga', externalId: 121496 },
  title: 'Solo Leveling',
  titleEnglish: 'Solo Leveling',
  titleNative: '나 혼자만 레벨업',
  imageUrl: 'https://cdn.myanimelist.net/images/manga/3/222295l.webp',
  format: 'manhwa',
  status: 'finished',
  totalUnits: 201,
  score: 8.55,
  year: 2018,
  genres: [
    { id: 1, name: 'Action' },
    { id: 2, name: 'Adventure' },
    { id: 10, name: 'Fantasy' },
  ],
  isAdult: false,
  synopsis: 'Placeholder synopsis.',
};

/** a synthetic adult anime (BR-06), with a title, a cover and a synopsis that must never show */
export const ADULT_DETAIL: MediaDetail = {
  key: { namespace: 'mal', kind: 'anime', externalId: 99999 },
  title: 'Adult placeholder',
  titleEnglish: 'Adult placeholder english',
  titleNative: null,
  imageUrl: 'https://cdn.myanimelist.net/images/anime/1/99999l.webp',
  format: 'ova',
  status: 'finished',
  totalUnits: 2,
  score: null,
  year: null,
  genres: [{ id: 12, name: 'Hentai' }],
  isAdult: true,
  synopsis: 'Adult placeholder synopsis.',
};
