import { LANGUAGE_PREFERENCES, useTranslation, type LanguagePreference } from '@core/i18n/index';
import { usePreferences } from '@core/preferences/index';
import { RadioGroup, Stack, Text, type RadioOption } from '@ui/index';
import { useMemo } from 'react';

/** the language setting (FR-31): system or a supported language, named in that language */
export function LanguagePicker() {
  const { t } = useTranslation();
  const { language, setLanguage } = usePreferences();
  const title = t('settings.language.title');
  const options = useMemo<readonly RadioOption<LanguagePreference>[]>(
    () =>
      LANGUAGE_PREFERENCES.map((value) => ({
        value,
        label: t(`settings.language.options.${value}`),
      })),
    [t],
  );

  return (
    <Stack gap="sm">
      <Text variant="subtitle">{title}</Text>
      <RadioGroup
        accessibilityLabel={title}
        options={options}
        value={language}
        onChange={setLanguage}
        testID="language-picker"
      />
    </Stack>
  );
}
