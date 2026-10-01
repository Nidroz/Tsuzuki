import { useTranslation } from '@core/i18n/index';
import { EmptyState, Screen, type ScreenEdge } from '@ui/index';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

// placeholder, replaced by the favorites screen in L-05
export function FavoritesScreen() {
  const { t } = useTranslation();

  return (
    <Screen edges={EDGES} testID="favorites-screen">
      <EmptyState
        title={t('favorites.placeholder.title')}
        message={t('favorites.placeholder.message')}
      />
    </Screen>
  );
}
