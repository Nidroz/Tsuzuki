import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import type { LanguagePreference } from '../i18n/index';
import type { ThemePreference } from './preferences';
import { MISSING_PREFERENCES_PROVIDER_MESSAGE, type Preferences } from './preferences-context';
import { PreferencesProvider } from './PreferencesProvider';
import { usePreferences } from './use-preferences';

const THEME_TEST_ID = 'theme';
const LANGUAGE_TEST_ID = 'language';
const DARK_BUTTON = 'dark';
const FRENCH_BUTTON = 'french';

type ThemeHandler = (theme: ThemePreference) => void;
type LanguageHandler = (language: LanguagePreference) => void;

// shows what usePreferences gives a consumer, with buttons that call the setters
function PreferencesProbe() {
  const { theme, language, setTheme, setLanguage } = usePreferences();
  return (
    <>
      <p data-testid={THEME_TEST_ID}>{theme}</p>
      <p data-testid={LANGUAGE_TEST_ID}>{language}</p>
      <button
        type="button"
        onClick={() => {
          setTheme('dark');
        }}
      >
        {DARK_BUTTON}
      </button>
      <button
        type="button"
        onClick={() => {
          setLanguage('fr');
        }}
      >
        {FRENCH_BUTTON}
      </button>
    </>
  );
}

interface CaptureProps {
  readonly onRender: (preferences: Preferences) => void;
}

// hands the context value of each render to the test
function PreferencesCapture({ onRender }: CaptureProps) {
  onRender(usePreferences());
  return null;
}

interface TreeOptions {
  readonly theme?: ThemePreference;
  readonly language?: LanguagePreference;
  readonly onThemeChange?: ThemeHandler;
  readonly onLanguageChange?: LanguageHandler;
}

const noTheme: ThemeHandler = () => undefined;
const noLanguage: LanguageHandler = () => undefined;

const tree = (
  {
    theme = 'system',
    language = 'system',
    onThemeChange = noTheme,
    onLanguageChange = noLanguage,
  }: TreeOptions,
  child = <PreferencesProbe />,
) => (
  <PreferencesProvider
    theme={theme}
    language={language}
    onThemeChange={onThemeChange}
    onLanguageChange={onLanguageChange}
  >
    {child}
  </PreferencesProvider>
);

const textOf = (testId: string) => screen.getByTestId(testId).textContent;

describe('PreferencesProvider', () => {
  it.each<[ThemePreference, LanguagePreference]>([
    ['system', 'system'],
    ['light', 'en'],
    ['dark', 'fr'],
  ])('exposes the theme %s and the language %s', (theme, language) => {
    render(tree({ theme, language }));

    expect(textOf(THEME_TEST_ID)).toBe(theme);
    expect(textOf(LANGUAGE_TEST_ID)).toBe(language);
  });

  it('calls onThemeChange from setTheme, and holds no state of its own', () => {
    const onThemeChange = jest.fn<ThemeHandler>();
    const onLanguageChange = jest.fn<LanguageHandler>();
    render(tree({ theme: 'light', onThemeChange, onLanguageChange }));

    fireEvent.click(screen.getByRole('button', { name: DARK_BUTTON }));

    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(onLanguageChange).not.toHaveBeenCalled();
    // controlled: the value changes only when the owner passes a new one
    expect(textOf(THEME_TEST_ID)).toBe('light');
  });

  it('calls onLanguageChange from setLanguage', () => {
    const onThemeChange = jest.fn<ThemeHandler>();
    const onLanguageChange = jest.fn<LanguageHandler>();
    render(tree({ language: 'en', onThemeChange, onLanguageChange }));

    fireEvent.click(screen.getByRole('button', { name: FRENCH_BUTTON }));

    expect(onLanguageChange).toHaveBeenCalledTimes(1);
    expect(onLanguageChange).toHaveBeenCalledWith('fr');
    expect(onThemeChange).not.toHaveBeenCalled();
    expect(textOf(LANGUAGE_TEST_ID)).toBe('en');
  });

  it('shows the new preferences when the owner passes them', () => {
    const { rerender } = render(tree({ theme: 'system', language: 'system' }));

    rerender(tree({ theme: 'dark', language: 'fr' }));

    expect(textOf(THEME_TEST_ID)).toBe('dark');
    expect(textOf(LANGUAGE_TEST_ID)).toBe('fr');
  });

  it('keeps the context value while the props stay the same, and replaces it otherwise', () => {
    const values: Preferences[] = [];
    const onRender = (preferences: Preferences) => {
      values.push(preferences);
    };
    // a new element each time, so the capture renders on every rerender
    const capture = () => <PreferencesCapture onRender={onRender} />;
    const { rerender } = render(tree({}, capture()));

    rerender(tree({}, capture()));
    rerender(tree({ theme: 'dark' }, capture()));
    rerender(tree({ theme: 'dark', onLanguageChange: jest.fn<LanguageHandler>() }, capture()));

    const [first, same, newTheme, newHandler] = values;
    expect(values).toHaveLength(4);
    expect(same).toBe(first);
    expect(newTheme).not.toBe(first);
    expect(newHandler).not.toBe(newTheme);
  });
});

describe('usePreferences', () => {
  it('throws outside PreferencesProvider', () => {
    expect(() => render(<PreferencesProbe />)).toThrow(MISSING_PREFERENCES_PROVIDER_MESSAGE);
  });
});
