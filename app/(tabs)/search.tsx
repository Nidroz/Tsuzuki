import { usePurgeGeneration } from '@core/hooks/use-device-purge';
import { SearchScreen } from '@features/search/SearchScreen';

// the tab stays mounted: the device purge of a sign out remounts the screen, so its text, filters,
// results and recent searches reset (ADR-0018)
export default function SearchRoute() {
  const purgeGeneration = usePurgeGeneration();
  return <SearchScreen key={purgeGeneration} />;
}
