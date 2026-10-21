import { describe, expect, it } from '@jest/globals';

import type { LanguagePreference } from '../i18n/index';
import type { StorageAdapter } from '../repositories/storage-adapter';
import type { ThemePreference } from './preferences';
import {
  LANGUAGE_PREFERENCE_KEY,
  loadPreferences,
  saveLanguagePreference,
  saveShowAdultPreference,
  saveThemePreference,
  SHOW_ADULT_PREFERENCE_KEY,
  THEME_PREFERENCE_KEY,
} from './preferences-storage';

const createMemoryStorage = (initial: Record<string, string> = {}): StorageAdapter => {
  const values = new Map(Object.entries(initial));
  return {
    getString: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    delete: (key) => {
      values.delete(key);
    },
  };
};

describe('preferences storage', () => {
  it('uses the namespaced keys', () => {
    expect(THEME_PREFERENCE_KEY).toBe('preferences.theme');
    expect(LANGUAGE_PREFERENCE_KEY).toBe('preferences.language');
    expect(SHOW_ADULT_PREFERENCE_KEY).toBe('preferences.showAdult');
  });

  // theme and language follow the device until the user picks one (FR-30, FR-31); adult titles
  // stay hidden until the user turns them on (BR-06, FR-32)
  it('defaults to system and hidden adult content when nothing is stored', () => {
    expect(loadPreferences(createMemoryStorage())).toStrictEqual({
      theme: 'system',
      language: 'system',
      showAdult: false,
    });
  });

  it.each<[ThemePreference, LanguagePreference]>([
    ['light', 'fr'],
    ['dark', 'en'],
    ['system', 'system'],
  ])('round-trips theme %s and language %s', (theme, language) => {
    const storage = createMemoryStorage();

    saveThemePreference(storage, theme);
    saveLanguagePreference(storage, language);

    expect(loadPreferences(storage)).toStrictEqual({ theme, language, showAdult: false });
  });

  it.each([true, false])('round-trips the adult content setting %s', (showAdult) => {
    const storage = createMemoryStorage();

    saveShowAdultPreference(storage, showAdult);

    expect(storage.getString(SHOW_ADULT_PREFERENCE_KEY)).toBe(String(showAdult));
    expect(loadPreferences(storage).showAdult).toBe(showAdult);
  });

  it('turns the adult content setting back off', () => {
    const storage = createMemoryStorage();

    saveShowAdultPreference(storage, true);
    saveShowAdultPreference(storage, false);

    expect(loadPreferences(storage).showAdult).toBe(false);
  });

  // fail closed: only the exact stored strings count, anything else hides adult titles
  it.each(['1', 'TRUE', 'True', 'yes', 'on', ' true', '"true"', ''])(
    'hides adult content for the invalid stored value %j',
    (stored) => {
      const storage = createMemoryStorage({ [SHOW_ADULT_PREFERENCE_KEY]: stored });

      expect(loadPreferences(storage).showAdult).toBe(false);
    },
  );

  it.each([
    ['sepia', 'de'],
    ['', ''],
    ['Dark', 'FR'],
    ['"dark"', ' fr'],
  ])('ignores the invalid stored theme %j and language %j', (theme, language) => {
    const storage = createMemoryStorage({
      [THEME_PREFERENCE_KEY]: theme,
      [LANGUAGE_PREFERENCE_KEY]: language,
    });

    expect(loadPreferences(storage)).toStrictEqual({
      theme: 'system',
      language: 'system',
      showAdult: false,
    });
  });

  it('keeps a valid preference when the others are invalid', () => {
    const storage = createMemoryStorage({
      [THEME_PREFERENCE_KEY]: 'dark',
      [LANGUAGE_PREFERENCE_KEY]: 'klingon',
      [SHOW_ADULT_PREFERENCE_KEY]: 'maybe',
    });

    expect(loadPreferences(storage)).toStrictEqual({
      theme: 'dark',
      language: 'system',
      showAdult: false,
    });
  });
});
