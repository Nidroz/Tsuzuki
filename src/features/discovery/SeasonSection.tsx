import { useCurrentSeason } from '@core/hooks/use-current-season';

import { DiscoveryPageList, type DiscoveryListProps } from './DiscoveryPageList';

export interface SeasonSectionProps extends DiscoveryListProps {
  /** the adult content setting (BR-06) */
  showAdult: boolean;
}

/** a page of the titles of the current season (FR-05) */
export function SeasonSection({ showAdult, ...listProps }: SeasonSectionProps) {
  const result = useCurrentSeason(listProps.currentPage, { showAdult });
  return <DiscoveryPageList result={result} {...listProps} />;
}
