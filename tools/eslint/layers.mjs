// layer rule tables for eslint.config.mjs: banned imports and jest module calls per layer and
// import-x/no-restricted-paths zones. the banned import tables (package groups, canonical paths,
// type-only core imports of src/platform) and the network guards live in
// tools/eslint/import-bans.mjs, the no-restricted-syntax guards in tools/eslint/syntax-guards.mjs
// (CONTRIBUTING.md section 4) and tools/eslint/text-guards.mjs (CONTRIBUTING.md section 5)

import { withDotNames } from './glob-dot-names.mjs';
import { BANNED, CANONICAL_PATHS, PLATFORM_CORE_TYPE_ONLY } from './import-bans.mjs';
import { toSelectorRegex } from './selectors.mjs';
import {
  CLASS_NAME_GUARDS,
  JEST_GUARDS,
  JIKAN_GUARDS,
  LAYERS_RULE,
  LITERAL_IMPORT_GUARD,
  STYLE_GUARDS,
  jestModuleBans,
} from './syntax-guards.mjs';
import { TEXT_GUARDS } from './text-guards.mjs';

// eslint.config.mjs reads the network guards from here, next to the other layer tables
export { NETWORK_GLOBALS, NETWORK_MESSAGE } from './import-bans.mjs';

// every file's no-restricted-syntax guards outside src/ui, tools/ included; a block that sets its
// own options must re-include them
export const BASE_SYNTAX_GUARDS = [...JIKAN_GUARDS, ...CLASS_NAME_GUARDS];

// every file under src/ belongs to a layer, so each file gets the rules of exactly one layer
const SRC_LAYER_FOLDERS = ['src/core', 'src/features', 'src/ui', 'src/platform'];
export const SRC_OUTSIDE_LAYERS = {
  files: ['src/**'],
  ignores: SRC_LAYER_FOLDERS.map((folder) => `${folder}/**`),
  rules: {
    'no-restricted-syntax': [
      'error',
      ...BASE_SYNTAX_GUARDS,
      {
        selector: 'Program',
        message: `every file under src/ belongs to one of the four layers: ${SRC_LAYER_FOLDERS.join(', ')} (${LAYERS_RULE}).`,
      },
    ],
  },
};

// flat config replaces (never merges) rule options for overlapping files, so each layer gets one
// complete option set for no-restricted-imports and no-restricted-syntax; bansStyles marks the
// screen layers (routes and features), which compose src/ui primitives instead of styling, and
// bansLiteralText their production code, which shows text through t('key') only
export const layerRules = ({
  banned: layerBanned,
  typeOnly,
  allowJikan = false,
  usesNativeWind = false,
  bansStyles = false,
  bansLiteralText = false,
}) => {
  const banned = [CANONICAL_PATHS, ...layerBanned];
  return {
    'no-restricted-imports': 'off',
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        patterns: [
          ...banned.flatMap(({ regexes, message }) => regexes.map((regex) => ({ regex, message }))),
          ...(typeOnly?.regexes ?? []).map((regex) => ({
            regex,
            message: typeOnly.message,
            allowTypeImports: true,
          })),
        ],
      },
    ],
    // static imports are covered above; these guards cover import() calls, always runtime imports,
    // and the jest module calls (canonical paths and package bans, on a string literal first
    // argument)
    'no-restricted-syntax': [
      'error',
      LITERAL_IMPORT_GUARD,
      ...JEST_GUARDS,
      ...[...banned, ...(typeOnly ? [typeOnly] : [])].flatMap(({ regexes, message }) =>
        regexes.map((regex) => ({
          selector: `ImportExpression[source.value=${toSelectorRegex(regex)}]`,
          message,
        })),
      ),
      ...jestModuleBans(banned),
      ...(allowJikan ? [] : JIKAN_GUARDS),
      ...(usesNativeWind ? [] : CLASS_NAME_GUARDS),
      ...(bansStyles ? STYLE_GUARDS : []),
      ...(bansLiteralText ? TEXT_GUARDS : []),
    ],
  };
};

const {
  reactNative,
  expo,
  nativewind,
  i18n,
  i18nInternals,
  supabase,
  network,
  expoInternals,
  uiInternals,
} = BANNED;
const SCREEN_LAYER_FOLDERS = ['src/features', 'app'];
const SCREEN_BANS = [
  nativewind,
  supabase,
  network,
  expoInternals,
  uiInternals,
  i18n,
  i18nInternals,
];
// test code inside the screen layers: jest tests and the data next to them hold literal text
const SCREEN_TEST_CODE = SCREEN_LAYER_FOLDERS.flatMap((folder) =>
  ['*.test.{ts,tsx}', '__tests__/**', '__fixtures__/**'].map((glob) => `${folder}/**/${glob}`),
);
export const LAYERS = [
  {
    files: ['src/core/**', 'test/core/**'],
    ignores: ['src/core/repositories/supabase/**', 'src/core/catalog/jikan/**', 'src/core/i18n/**'],
    banned: [reactNative, expo, nativewind, supabase, i18n],
  },
  {
    files: ['src/core/catalog/jikan/**'],
    banned: [reactNative, expo, nativewind, supabase, i18n],
    allowJikan: true,
  },
  { files: ['src/core/repositories/supabase/**'], banned: [reactNative, expo, nativewind, i18n] },
  { files: ['src/core/i18n/**'], banned: [reactNative, expo, nativewind, supabase] },
  { files: ['src/ui/**'], banned: [supabase, network, expoInternals, i18n], usesNativeWind: true },
  {
    files: ['src/platform/**'],
    // the i18n internals are banned as types too: the barrel is the only spelling
    banned: [nativewind, supabase, i18n, i18nInternals],
    typeOnly: PLATFORM_CORE_TYPE_ONLY,
  },
  {
    files: SCREEN_LAYER_FOLDERS.map((folder) => `${folder}/**`),
    ignores: SCREEN_TEST_CODE,
    banned: SCREEN_BANS,
    bansStyles: true,
    bansLiteralText: true,
  },
  { files: SCREEN_TEST_CODE, banned: SCREEN_BANS, bansStyles: true },
];

// production code logs nothing: errors go through the core ErrorReporter port (ADR-0012). the
// sentry adapter is the only exception, its reporter writes to the console in development, where
// sentry is off. test code is exempt: the console check of the jest setups calls console on purpose
export const CONSOLE_ALLOWED_FILES = ['src/platform/sentry.ts'];
const TEST_CODE = [
  '**/*.test.{ts,tsx}',
  '**/__tests__/**',
  '**/__fixtures__/**',
  '**/__mocks__/**',
];
export const NO_CONSOLE = {
  files: ['app/**', 'src/**'],
  ignores: [...TEST_CODE, ...CONSOLE_ALLOWED_FILES],
  rules: { 'no-console': 'error' },
};

const layerZone = (target, from, message) => ({
  target,
  from,
  message: `${message} (${LAYERS_RULE}).`,
});

// every catalog provider adapter and repository implementation folder: a new provider next to
// jikan/ must be added here
const IMPLEMENTATION_FOLDERS = [
  './src/core/catalog/jikan',
  './src/core/repositories/supabase',
  './src/core/repositories/local',
];

const CORE_ROOT = './src/core';

// globs for every file under root except the excluded folders (leaves under root): at each level
// on the way down to them, the files of that folder plus every sibling folder. targets are
// minimatch globs on absolute paths; on windows the resolved target puts a backslash before each
// segment, which escapes a leading "!(": each pattern keeps another glob character to stay a glob
const targetsExcept = (root, excluded) => {
  const children = new Map();
  for (const folder of excluded) {
    if (!folder.startsWith(`${root}/`)) {
      throw new Error(`${folder} is not under ${root}`);
    }
    const segments = folder.slice(`${root}/`.length).split('/');
    segments.forEach((segment, index) => {
      const parent = [root, ...segments.slice(0, index)].join('/');
      children.set(parent, new Set([...(children.get(parent) ?? []), segment]));
    });
  }
  return [...children].flatMap(([folder, names]) => [
    `${folder}/*.*`,
    `${folder}/!(${[...names].join('|')})/**`,
  ]);
};

// zones for import-x/no-restricted-paths, relative to the config's basePath (the repo root); every
// glob target also covers dotfiles and dot-folders (tools/eslint/glob-dot-names.mjs)
export const LAYER_ZONES = [
  layerZone(
    './src/core',
    ['./src/platform', './src/features', './src/ui', './app'],
    'src/core is platform-agnostic and imports no other layer',
  ),
  // the implementation folders themselves are left out of the targets
  layerZone(
    [...targetsExcept(CORE_ROOT, IMPLEMENTATION_FOLDERS), './test/core/**'],
    IMPLEMENTATION_FOLDERS,
    'src/core uses repository and catalog provider interfaces; only the implementation folders themselves (and app/_layout.tsx) touch implementations',
  ),
  layerZone(
    './src/ui',
    ['./src/core', './src/features', './src/platform', './app'],
    'src/ui depends only on itself (theme and components)',
  ),
  layerZone(
    './src/platform',
    ['./src/features', './src/ui', './app'],
    'src/platform depends only on src/core',
  ),
  layerZone('./src/features', ['./app'], 'app/ is the composition root: nothing imports it'),
  layerZone(
    './src/features',
    IMPLEMENTATION_FOLDERS,
    'src/features uses src/core hooks, never repository or catalog provider implementations',
  ),
  // targets are minimatch globs on absolute paths: every nested file (nested layouts included),
  // every root file not named _layout.*, and every _layout.* variant except _layout.tsx. on
  // windows the resolved target puts a backslash before each segment, which escapes a leading
  // "!(": every pattern needs another glob character to stay a glob
  layerZone(
    ['./app/*/**', './app/!(_layout).*', './app/_layout.!(tsx)'],
    IMPLEMENTATION_FOLDERS,
    'only app/_layout.tsx (the composition root) wires repository and catalog provider implementations',
  ),
  // every file of app/ and src/ except the colocated jest tests; the "**" keeps each pattern a glob
  // on windows, where the backslash before "!(" escapes it (see above)
  layerZone(
    ['./app/**/!(*.test.ts|*.test.tsx)', './src/**/!(*.test.ts|*.test.tsx)'],
    './test',
    'production code never imports the test infrastructure in test/: only tests do',
  ),
].map(withDotNames);
