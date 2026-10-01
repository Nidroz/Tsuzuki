import { useTranslation } from '@core/i18n/index';
import { ErrorState, Screen, type ScreenEdge } from '@ui/index';
import { useRouter } from 'expo-router';

// under the stack header: the top inset is the header's
const EDGES: readonly ScreenEdge[] = ['bottom', 'left', 'right'];

const DISCOVER_PATH = '/';

// replaces expo-router's untranslated default screen for unmatched links
export default function NotFoundRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToDiscover = () => {
    router.dismissTo(DISCOVER_PATH);
  };

  return (
    <Screen edges={EDGES} testID="not-found-screen">
      <ErrorState
        title={t('notFound.title')}
        message={t('notFound.message')}
        retry={{ label: t('notFound.action'), onPress: goToDiscover }}
      />
    </Screen>
  );
}
