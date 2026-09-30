/**
 * polyfills Intl.PluralRules on engines that lack it, such as hermes (react native): without it i18next
 * picks plural forms with a naive one/other rule, wrong for french. side effects only, imported
 * first by the root layout so the rules exist before i18next builds its plural resolvers.
 *
 * the imports are synchronous and safe where the engine is complete: polyfill.js installs itself
 * only when shouldPolyfill() says so, and each locale data file registers only into the polyfill.
 * the polyfill needs Intl.getCanonicalLocales, which hermes has; Intl.Locale is only used to match
 * a tag that has no locale data of its own, and i18next only asks for the supported languages
 */
import '@formatjs/intl-pluralrules/polyfill.js';
// one locale data file per supported language (SUPPORTED_LANGUAGES in src/core/i18n)
import '@formatjs/intl-pluralrules/locale-data/en.js';
import '@formatjs/intl-pluralrules/locale-data/fr.js';
