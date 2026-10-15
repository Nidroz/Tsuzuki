import type { MediaFormat } from '@core/domain/media';
import type { TranslationKey } from '@core/i18n/index';

/** the translation key of each format: the result rows and the format filter chips */
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
