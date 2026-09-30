# src/core/i18n

Translations and locale-aware formatting. This is the only place in the repository with non-English content: the French UI translation in `fr.json`.
`src/core/` never imports React Native, Expo modules or NativeWind: the device languages come from a platform adapter.

Routes and features import `@core/i18n/index` only, never `i18next` directly.

## Files

| File | Role |
| --- | --- |
| `en.json`, `fr.json` | The catalogs: one i18next namespace (`translation`), keys nested by feature (`home.title`) |
| `languages.ts` | Supported languages (`en`, `fr`), the English fallback, the language preference (`system`, `en`, `fr`) |
| `device-language-tags.ts` | Zod schema for the untrusted device language tags: a non-array gives `[]`, invalid entries are dropped |
| `resolve-language.ts` | `resolveLanguage(preference, deviceTags)`: an explicit preference wins; `system` takes the first device tag whose primary subtag is supported (`fr-CA` gives `fr`), else English |
| `locale-adapter.ts` | `LocaleAdapter`, the interface a platform implements (`src/platform/locale.ts` on mobile) |
| `resources.ts` | The bundled catalogs, loaded in memory |
| `i18next.d.ts` | Types `t` against `en.json`: an unknown key is a type error, even with a default value |
| `create-i18n.ts` | `createI18n`: a new, synchronously initialized i18next instance per call (no global singleton), with an optional missing key handler; `hasIntlPluralRules` |
| `format.ts` | `formatNumber` and `formatDate` with a required language |
| `I18nProvider.tsx`, `i18n-context.ts` | The provider: one instance per language, so a language switch re-renders every consumer on the next render |
| `use-translation.ts` | `useTranslation()`: `t`, `language`, and `formatNumber` / `formatDate` bound to the active language; `TranslationKey` for props that take a key |

## Rules

- Every user-facing string is `t('feature.key')`. Add each key to `en.json` and `fr.json` in the same change.
- `fr.json` mirrors `en.json` exactly: same keys, same nesting, same interpolation variables. A key missing from `fr.json` would silently show the English text, since English is the fallback language.
- Plurals use i18next suffixes chosen by `Intl.PluralRules`, and each catalog carries every category of its language: English `_one` / `_other`, French `_one` / `_many` / `_other` (`_many` is used for large round numbers, e.g. "1 000 000 d’objets").
- Formatting (numbers, dates) always passes an explicit locale: through `useTranslation()` in components, or `formatNumber(value, language)` / `formatDate(value, language)`. Never call `toLocaleString()` without a locale: output would depend on the machine.
- A key missing from every catalog calls the provider's `onMissingKey` (a development warning in the app); a missing plural key is reported once per plural category of the active language.
