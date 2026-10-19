// the translation keys and label rules of a media, shared by the screens that show one: search
// results, discovery and the detail screen. pure mappings, exported through the public api index.ts
import type { MediaDetail, MediaSummary } from '../catalog/catalog-provider';
import type { MediaFormat, MediaKind, MediaStatus } from '../domain/media';
import type { TranslationKey } from './use-translation';

/** the translation key of each format: the result rows, the format filter chips, the details */
export const FORMAT_KEYS = {
  tv: 'media.format.tv',
  movie: 'media.format.movie',
  ova: 'media.format.ova',
  ona: 'media.format.ona',
  special: 'media.format.special',
  music: 'media.format.music',
  manga: 'media.format.manga',
  manhwa: 'media.format.manhwa',
  manhua: 'media.format.manhua',
  light_novel: 'media.format.light_novel',
  novel: 'media.format.novel',
  one_shot: 'media.format.one_shot',
  doujinshi: 'media.format.doujinshi',
  oel: 'media.format.oel',
  unknown: 'media.format.unknown',
} as const satisfies Record<MediaFormat, TranslationKey>;

/** the translation key of each publication status, per kind: an ongoing anime is airing, an ongoing manga publishing */
export const STATUS_KEYS = {
  anime: {
    ongoing: 'media.status.airing',
    finished: 'media.status.finished',
    upcoming: 'media.status.upcoming',
    hiatus: 'media.status.hiatus',
    discontinued: 'media.status.discontinued',
  },
  manga: {
    ongoing: 'media.status.publishing',
    finished: 'media.status.finished',
    upcoming: 'media.status.upcoming',
    hiatus: 'media.status.hiatus',
    discontinued: 'media.status.discontinued',
  },
} as const satisfies Record<MediaKind, Record<MediaStatus, TranslationKey>>;

/** the plural translation key of the total units of each kind: episodes or chapters */
export const TOTAL_UNITS_KEYS = {
  anime: 'media.totalUnits.episodes',
  manga: 'media.totalUnits.chapters',
} as const satisfies Record<MediaKind, TranslationKey>;

/** a year is written without digit grouping in every language */
export const YEAR_FORMAT: Intl.NumberFormatOptions = { useGrouping: false };

/** the english title when it says more than the title: present and different ignoring case */
export const englishTitleOf = (
  item: Pick<MediaSummary, 'title' | 'titleEnglish'>,
): string | undefined =>
  item.titleEnglish !== null && item.titleEnglish.toLowerCase() !== item.title.toLowerCase()
    ? item.titleEnglish
    : undefined;

/** the native title when it says more than the title: present and different */
export const nativeTitleOf = (
  item: Pick<MediaDetail, 'title' | 'titleNative'>,
): string | undefined =>
  item.titleNative !== null && item.titleNative !== item.title ? item.titleNative : undefined;
