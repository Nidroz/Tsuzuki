import { Screen, Stack, type ScreenEdge } from '@ui/index';

import { AccountSection } from './AccountSection';
import { AdultContentSetting } from './AdultContentSetting';
import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

/** the app settings: the account, then theme, language and adult content */
export function SettingsScreen() {
  return (
    <Screen scroll edges={EDGES} testID="settings-screen">
      <Stack gap="xl">
        <AccountSection />
        <ThemePicker />
        <LanguagePicker />
        <AdultContentSetting />
      </Stack>
    </Screen>
  );
}
