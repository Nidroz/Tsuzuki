import { useTranslation } from '@core/i18n/index';
import { THEME_PREFERENCES, usePreferences, type ThemePreference } from '@core/preferences/index';
import { RadioGroup, Stack, Text, type RadioOption } from '@ui/index';
import { useMemo } from 'react';

/** the theme setting (FR-30): system, light or dark */
export function ThemePicker() {
  const { t } = useTranslation();
  const { theme, setTheme } = usePreferences();
  const title = t('settings.theme.title');
  const options = useMemo<readonly RadioOption<ThemePreference>[]>(
    () =>
      THEME_PREFERENCES.map((value) => ({
        value,
        label: t(`settings.theme.options.${value}`),
      })),
    [t],
  );

  return (
    <Stack gap="sm">
      <Text variant="subtitle">{title}</Text>
      <RadioGroup
        accessibilityLabel={title}
        options={options}
        value={theme}
        onChange={setTheme}
        testID="theme-picker"
      />
    </Stack>
  );
}
