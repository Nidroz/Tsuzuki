import { describe, expect, it } from '@jest/globals';

import type { LanguagePreference } from '../i18n/index';
import type { StorageAdapter } from '../repositories/storage-adapter';
import type { ThemePreference } from './preferences';
import {
  LANGUAGE_PREFERENCE_KEY,
  loadPreferences,
  saveLanguagePreference,
  saveThemePreference,
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
  });

  // both follow the device until the user picks one (FR-30, FR-31)
  it('defaults both preferences to system when nothing is stored', () => {
    expect(loadPreferences(createMemoryStorage())).toStrictEqual({
      theme: 'system',
      language: 'system',
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

    expect(loadPreferences(storage)).toStrictEqual({ theme, language });
  });

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

    expect(loadPreferences(storage)).toStrictEqual({ theme: 'system', language: 'system' });
  });

  it('keeps a valid preference when the other one is invalid', () => {
    const storage = createMemoryStorage({
      [THEME_PREFERENCE_KEY]: 'dark',
      [LANGUAGE_PREFERENCE_KEY]: 'klingon',
    });

    expect(loadPreferences(storage)).toStrictEqual({ theme: 'dark', language: 'system' });
  });
});
