import { useTranslation } from '@core/i18n/index';
import { EmptyState, Screen, type ScreenEdge } from '@ui/index';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

// placeholder, replaced by the discovery screen in C-08
export function DiscoveryScreen() {
  const { t } = useTranslation();

  return (
    <Screen edges={EDGES} testID="discover-screen">
      <EmptyState
        title={t('discovery.placeholder.title')}
        message={t('discovery.placeholder.message')}
      />
    </Screen>
  );
}
