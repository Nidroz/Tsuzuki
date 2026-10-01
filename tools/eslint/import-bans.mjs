// banned import tables of the layer rules (tools/eslint/layers.mjs, CONTRIBUTING.md section 4):
// banned package groups, canonical import paths, the type-only core imports of src/platform and
// the network guards; layers.mjs assigns them to each layer

import { LAYERS_RULE } from './syntax-guards.mjs';

const I18N_RULE = 'docs/adr/0011-internationalization-i18next.md';

export const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
export const NETWORK_MESSAGE = `routes, features and UI components have no direct network access: it goes through src/core and src/platform (${LAYERS_RULE}).`;

// banned package groups; F-05/F-06 extend this table
export const BANNED = {
  reactNative: {
    regexes: [
      '^react-native($|/)',
      '^react-native-',
      '^@react-native(-[^/]+)?/',
      '^@[^/]+/react-native',
    ],
    message: `src/core stays platform-agnostic: no React Native (${LAYERS_RULE}).`,
  },
  expo: {
    regexes: ['^expo($|/)', '^expo-', '^@expo/'],
    message: `src/core stays platform-agnostic: no Expo module (${LAYERS_RULE}).`,
  },
  nativewind: {
    regexes: ['^nativewind($|/)', '^react-native-css-interop'],
    message: `NativeWind is used only inside src/ui (${LAYERS_RULE}).`,
  },
  // owner decision: i18n libraries stay behind the public api of src/core/i18n
  i18n: {
    regexes: ['^i18next($|/)', '^react-i18next($|/)'],
    message: `i18next and react-i18next are imported only in src/core/i18n: every other file translates through @core/i18n (${I18N_RULE}).`,
  },
  // same shape as uiInternals below, for src/core/i18n. known false positive: a core/i18n folder
  // under app/ or a feature, imported relatively
  i18nInternals: {
    regexes: ['^@core/i18n(?!/index$)(?:$|/)', '^(?:\\.{1,2}/)+(?:src/)?core/i18n(?:$|/)'],
    message: `routes, features and src/platform import src/core/i18n through @core/i18n/index only: the barrel is the public API of the i18n module, and its internals (such as createI18n and resources) are not (${I18N_RULE}).`,
  },
  supabase: {
    regexes: ['^@supabase/'],
    message: `the Supabase client is imported only in src/core/repositories/supabase (${LAYERS_RULE}).`,
  },
  network: { regexes: ['^expo/fetch(?:$|[./])'], message: NETWORK_MESSAGE },
  // expo/src and expo/build reach modules such as fetch without their public specifier
  expoInternals: {
    regexes: ['^expo/(?:src|build)(?:$|/)'],
    message: `deep imports of Expo internals bypass the rules on routes, features and UI components: use public entry points (${LAYERS_RULE}).`,
  },
  // any @ui specifier other than exactly @ui/index, and any relative path into src/ui, the barrel
  // included: a relative path whose first folder after its ./ and ../ segments is ui or src/ui.
  // known false positive: a folder literally named ui under app/ or a feature, imported relatively
  uiInternals: {
    regexes: ['^@ui(?!/index$)(?:$|/)', '^(?:\\.{1,2}/)+(?:src/)?ui(?:$|/)'],
    message: `routes and features import src/ui through @ui/index only: the barrel is the public API of the design system, and its internals (such as useThemeColors, which returns raw values) are not (${LAYERS_RULE}).`,
  },
};

// the rules above read the specifier text: "@core/../x", "@core/./x", "@core//x" or a node_modules
// path would slip past them. the last pattern is a "." or empty segment after the first one (a
// slash followed by an optional dot, then a slash or the end); a leading "./" or "." stays allowed
export const CANONICAL_PATHS = {
  regexes: [
    '(?:^|/)node_modules(?:/|$)',
    '(?:^|/)(?!\\.\\.(?:/|$))[^/]+/\\.\\.(?:/|$)',
    '/\\.?(?:/|$)',
  ],
  message: `import paths are written canonically, with no ".." after a segment, no "." or empty segment after the first one and no node_modules path, so layer rules can check them (${LAYERS_RULE}).`,
};

// platform may import core only as types, except typed errors (owner decision). a type import that
// matches a pattern allowing types skips every other one: in src/core/i18n, only the barrel does
export const PLATFORM_CORE_TYPE_ONLY = {
  regexes: [
    '^@core(?:$|/(?!(?:errors|i18n)(?:/|$)))',
    '^(?:\\.{1,2}/)+(?:src/)?core(?:$|/(?!(?:errors|i18n)(?:/|$)))',
    '^@core/i18n/index$',
  ],
  message: `src/platform imports src/core with "import type" only, except @core/errors (${LAYERS_RULE}).`,
};
