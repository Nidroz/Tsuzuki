import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import type { Locale } from 'expo-localization';

import { useDeviceLanguageTags } from './locale';

// the device locales, as expo-localization reports them: only the tag is read
type DeviceLocale = Pick<Locale, 'languageTag'>;

const mockUseLocales = jest.fn<() => readonly DeviceLocale[]>();

// the factory runs when the adapter is imported, before this mock is initialized: it calls it lazily
jest.mock('expo-localization', () => ({ useLocales: () => mockUseLocales() }));

const localesOf = (...tags: string[]): DeviceLocale[] =>
  tags.map((languageTag) => ({ languageTag }));

// restoreMocks restores spies only: the module mock is reset by hand
beforeEach(() => {
  mockUseLocales.mockReset();
});

describe('useDeviceLanguageTags', () => {
  it('gives the language tag of each device locale, most preferred first', async () => {
    mockUseLocales.mockReturnValue(localesOf('fr-CA', 'en-US', 'de-DE'));

    const { result } = await renderHook(() => useDeviceLanguageTags());

    expect(result.current).toStrictEqual(['fr-CA', 'en-US', 'de-DE']);
  });

  it('passes the tags on as reported, for resolveLanguage to parse', async () => {
    mockUseLocales.mockReturnValue(localesOf('FR_ca', ' en-US ', ''));

    const { result } = await renderHook(() => useDeviceLanguageTags());

    expect(result.current).toStrictEqual(['FR_ca', ' en-US ', '']);
  });

  it('keeps the same tags array while the device locales do not change', async () => {
    mockUseLocales.mockReturnValue(localesOf('fr-FR', 'en-US'));
    const { result, rerender } = await renderHook(() => useDeviceLanguageTags());
    const first = result.current;

    await rerender(undefined);

    expect(result.current).toBe(first);
  });

  it('gives new tags when the device locales change while the app runs', async () => {
    mockUseLocales.mockReturnValue(localesOf('en-US'));
    const { result, rerender } = await renderHook(() => useDeviceLanguageTags());
    const first = result.current;

    mockUseLocales.mockReturnValue(localesOf('fr-FR', 'en-US'));
    await rerender(undefined);

    expect(result.current).not.toBe(first);
    expect(result.current).toStrictEqual(['fr-FR', 'en-US']);
  });
});
