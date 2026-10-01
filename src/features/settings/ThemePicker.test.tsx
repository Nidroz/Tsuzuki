import type { LanguagePreference } from '@core/i18n/index';
import { PreferencesProvider, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { ThemePicker } from './ThemePicker';

const TITLE = 'Theme';
const LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
const FRENCH_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'Système',
  light: 'Clair',
  dark: 'Sombre',
};

const TEST_ID = 'theme-picker';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

const renderPicker = (
  theme: ThemePreference,
  onThemeChange: (theme: ThemePreference) => void = jest.fn(),
  language: 'en' | 'fr' = 'en',
) =>
  renderWithProviders(
    <PreferencesProvider
      theme={theme}
      language="system"
      onThemeChange={onThemeChange}
      onLanguageChange={jest.fn<(language: LanguagePreference) => void>()}
    >
      <ThemePicker />
    </PreferencesProvider>,
    language,
  );

describe('ThemePicker', () => {
  it('is a radio group named by the visible section title', async () => {
    await renderPicker('system');

    const group = screen.getByTestId(TEST_ID);
    expect(group).toHaveProp('accessibilityRole', 'radiogroup');
    expect(group).toHaveProp('accessibilityLabel', TITLE);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
  });

  it('renders one translated radio per theme preference', async () => {
    await renderPicker('system', jest.fn(), 'fr');

    expect(screen.getAllByRole('radio')).toHaveLength(THEMES.length);
    for (const theme of THEMES) {
      expect(screen.getByRole('radio', { name: FRENCH_LABELS[theme] })).toBeOnTheScreen();
    }
  });

  it.each(THEMES)('checks only the current %s preference', async (current) => {
    await renderPicker(current);

    expect(screen.getByRole('radio', { checked: true })).toBe(
      screen.getByRole('radio', { name: LABELS[current] }),
    );
  });

  it('calls the theme setter with the pressed preference', async () => {
    const onThemeChange = jest.fn<(theme: ThemePreference) => void>();
    const user = userEvent.setup();
    await renderPicker('system', onThemeChange);

    await user.press(screen.getByRole('radio', { name: LABELS.dark }));

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });
});
