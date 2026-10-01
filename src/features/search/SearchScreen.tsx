import { useTranslation } from '@core/i18n/index';
import { EmptyState, Screen, type ScreenEdge } from '@ui/index';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

// placeholder, replaced by the search screen in C-04
export function SearchScreen() {
  const { t } = useTranslation();

  return (
    <Screen edges={EDGES} testID="search-screen">
      <EmptyState title={t('search.placeholder.title')} message={t('search.placeholder.message')} />
    </Screen>
  );
}
