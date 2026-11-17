import { toAllowedImageUrl } from '../catalog/image-url';
import type { LibraryEntry } from '../domain/library-entry';

/**
 * the provider of the covers a library list shows: its namespace (a string: compared with the
 * namespace of entries stored by any provider) and its cdn hosts
 */
export interface CoverSource {
  readonly namespace: string;
  readonly imageHosts: readonly string[];
}

/**
 * a stored cover is untrusted (CONTRIBUTING.md §7): kept on a cdn host of the entry's provider
 * only, else null. a display copy, the entry itself when the cover is kept
 */
export const withAllowedCover = (entry: LibraryEntry, source: CoverSource): LibraryEntry => {
  const imageUrl =
    entry.key.namespace === source.namespace
      ? toAllowedImageUrl(entry.media.imageUrl, source.imageHosts)
      : null;
  return imageUrl === entry.media.imageUrl
    ? entry
    : { ...entry, media: { ...entry.media, imageUrl } };
};
