import type { LanguagePreference } from '@core/i18n/index';
import { PreferencesProvider, type ThemePreference } from '@core/preferences/index';
import { describe, expect, it, jest } from '@jest/globals';
import { screen, userEvent } from '@testing-library/react-native';

import { renderWithProviders } from '../../../test/mobile/render-with-providers';
import { SettingsScreen } from './SettingsScreen';

const SCROLL_VIEW_HOST = 'RCTScrollView';

const renderScreen = (
  onThemeChange: (theme: ThemePreference) => void = jest.fn(),
  onLanguageChange: (language: LanguagePreference) => void = jest.fn(),
) =>
  renderWithProviders(
    <PreferencesProvider
      theme="light"
      language="fr"
      onThemeChange={onThemeChange}
      onLanguageChange={onLanguageChange}
    >
      <SettingsScreen />
    </PreferencesProvider>,
  );

describe('SettingsScreen', () => {
  it('renders the theme and language pickers in a scroll view', async () => {
    await renderScreen();

    expect(screen.getByTestId('settings-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('theme-picker')).toBeOnTheScreen();
    expect(screen.getByTestId('language-picker')).toBeOnTheScreen();
    // the only child of the safe area is the scroll view, so long text sizes stay reachable
    expect(screen.getByTestId('settings-screen').children[0]).toHaveProperty(
      'type',
      SCROLL_VIEW_HOST,
    );
  });

  it('checks the current theme and language', async () => {
    await renderScreen();

    expect(screen.getAllByRole('radio', { checked: true })).toStrictEqual([
      screen.getByTestId('theme-picker-light'),
      screen.getByTestId('language-picker-fr'),
    ]);
  });

  it('sends each choice to its own setter', async () => {
    const onThemeChange = jest.fn<(theme: ThemePreference) => void>();
    const onLanguageChange = jest.fn<(language: LanguagePreference) => void>();
    const user = userEvent.setup();
    await renderScreen(onThemeChange, onLanguageChange);

    await user.press(screen.getByRole('radio', { name: 'Dark' }));
    await user.press(screen.getByRole('radio', { name: 'English' }));

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(onLanguageChange).toHaveBeenCalledTimes(1);
    expect(onLanguageChange).toHaveBeenCalledWith('en');
  });
});
