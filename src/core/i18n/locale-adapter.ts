/**
 * device locale access, implemented by each platform: expo-localization on mobile
 * (src/platform/locale.ts); a web app would read navigator.languages and listen to the
 * languagechange event. it is a hook so the tags follow a change of the os languages while the app
 * runs. the tags are untrusted input: resolveLanguage parses them
 */
export interface LocaleAdapter {
  /** the device language tags (bcp 47, e.g. "fr-CA"), most preferred first */
  useDeviceLanguageTags: () => readonly string[];
}
