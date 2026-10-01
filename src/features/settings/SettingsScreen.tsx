import { Screen, Stack, type ScreenEdge } from '@ui/index';

import { LanguagePicker } from './LanguagePicker';
import { ThemePicker } from './ThemePicker';

// under the navigator header and above the tab bar: only the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['left', 'right'];

/** the app settings: theme and language */
export function SettingsScreen() {
  return (
    <Screen scroll edges={EDGES} testID="settings-screen">
      <Stack gap="xl">
        <ThemePicker />
        <LanguagePicker />
      </Stack>
    </Screen>
  );
}
