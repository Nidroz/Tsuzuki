import type { LanguagePreference } from '@core/i18n/index';
import { PreferencesProvider, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { LanguagePicker } from './LanguagePicker';

const TITLE = 'Language';
// languages are named in their own language in every catalog; only system is translated
const LABELS: Readonly<Record<LanguagePreference, string>> = {
  system: 'System',
  en: 'English',
  fr: 'Français',
};
const FRENCH_SYSTEM_LABEL = 'Système';

const TEST_ID = 'language-picker';
const LANGUAGES: readonly LanguagePreference[] = ['system', 'en', 'fr'];

const renderPicker = (
  language: LanguagePreference,
  onLanguageChange: (language: LanguagePreference) => void = jest.fn(),
  uiLanguage: 'en' | 'fr' = 'en',
) =>
  renderWithProviders(
    <PreferencesProvider
      theme="system"
      language={language}
      onThemeChange={jest.fn<(theme: ThemePreference) => void>()}
      onLanguageChange={onLanguageChange}
    >
      <LanguagePicker />
    </PreferencesProvider>,
    uiLanguage,
  );

describe('LanguagePicker', () => {
  it('is a radio group named by the visible section title', async () => {
    await renderPicker('system');

    const group = screen.getByTestId(TEST_ID);
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', TITLE);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });

  it('names the languages in their own language and translates only system', async () => {
    await renderPicker('system', jest.fn(), 'fr');

    expect(screen.getAllByRole('radio')).toHaveLength(LANGUAGES.length);
    expect(screen.getByRole('radio', { name: FRENCH_SYSTEM_LABEL })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: LABELS.en })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: LABELS.fr })).toBeOnTheScreen();
  });

  it.each(LANGUAGES)('checks only the current %s preference', async (current) => {
    await renderPicker(current);

    expect(screen.getByRole('radio', { checked: true })).toBe(
      screen.getByRole('radio', { name: LABELS[current] }),
    );
  });

  it('calls the language setter with the pressed preference', async () => {
    const onLanguageChange = jest.fn<(language: LanguagePreference) => void>();
    const user = userEvent.setup();
    await renderPicker('system', onLanguageChange);

    await user.press(screen.getByRole('radio', { name: LABELS.fr }));

    expect(onLanguageChange).toHaveBeenCalledTimes(1);
    expect(onLanguageChange).toHaveBeenCalledWith('fr');
  });
});
