import type { TopParams } from '@core/catalog/catalog-provider';
import type { MediaKind, SearchableMangaFormat } from '@core/domain/media';
import { useTopMedia } from '@core/hooks/use-top-media';

import { DiscoveryPageList, type DiscoveryListProps } from './DiscoveryPageList';

export interface TopMediaSectionProps extends DiscoveryListProps {
  kind: MediaKind;
  /** the manga format of the top list, null for every format */
  format: SearchableMangaFormat | null;
  /** the adult content setting (BR-06) */
  showAdult: boolean;
}

// no format key without a format (exactOptionalPropertyTypes)
const topParams = (
  kind: MediaKind,
  format: SearchableMangaFormat | null,
  page: number,
): TopParams => (format === null ? { kind, page } : { kind, format, page });

/** a page of the top list of a kind, of one format or of every format (FR-05) */
export function TopMediaSection({ kind, format, showAdult, ...listProps }: TopMediaSectionProps) {
  const result = useTopMedia(topParams(kind, format, listProps.currentPage), { showAdult });
  return <DiscoveryPageList result={result} {...listProps} />;
}
