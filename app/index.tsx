import { useTranslation } from '@core/i18n/index';
import { Screen, Text } from '@ui/index';

// temporary home screen, replaced by the tabs shell in F-07
export default function IndexScreen() {
  const { t } = useTranslation();

  return (
    <Screen testID="home-screen">
      <Text variant="title">{t('home.title')}</Text>
    </Screen>
  );
}
