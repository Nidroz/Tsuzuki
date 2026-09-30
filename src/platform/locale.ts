import type { LocaleAdapter } from '@core/i18n/index';
import { useLocales } from 'expo-localization';
import { useMemo } from 'react';

/**
 * the device language tags, most preferred first, from expo-localization. useLocales re-renders
 * when the os languages change while the app runs; the tags keep their identity until then
 */
export const useDeviceLanguageTags: LocaleAdapter['useDeviceLanguageTags'] = () => {
  const locales = useLocales();
  return useMemo(() => locales.map(({ languageTag }) => languageTag), [locales]);
};
