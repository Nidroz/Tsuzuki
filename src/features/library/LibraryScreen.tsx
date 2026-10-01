import { useTranslation } from '@core/i18n/index';
import { EmptyState, Screen, type ScreenEdge } from '@ui/index';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

// placeholder, replaced by the library screen in L-04
export function LibraryScreen() {
  const { t } = useTranslation();

  return (
    <Screen edges={EDGES} testID="library-screen">
      <EmptyState
        title={t('library.placeholder.title')}
        message={t('library.placeholder.message')}
      />
    </Screen>
  );
}
