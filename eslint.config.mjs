import { existsSync } from 'node:fs';
import path from 'node:path';

import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import tseslint from 'typescript-eslint';

const ROOT = import.meta.dirname;
const TS_FILES = ['**/*.{ts,tsx}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
const LAYERS_RULE = 'CONTRIBUTING.md section 4';

// ignore patterns are resolved against this config's folder (the repo root), not the ignore file's
const ignoreFiles = [path.join(ROOT, '.gitignore'), path.join(ROOT, '.git', 'info', 'exclude')];

const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket'];
const NETWORK_MESSAGE = `screens and ui reach the network only through src/core hooks (${LAYERS_RULE}).`;

// banned package groups; F-05/F-06 extend this table
const BANNED = {
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
  supabase: {
    regexes: ['^@supabase/'],
    message: `the Supabase client is imported only in src/core/repositories/supabase (${LAYERS_RULE}).`,
  },
  network: { regexes: ['^expo/fetch(?:$|[./])'], message: NETWORK_MESSAGE },
  // expo/src and expo/build reach modules such as fetch without their public specifier
  expoInternals: {
    regexes: ['^expo/(?:src|build)(?:$|/)'],
    message: `deep imports of Expo internals bypass the rules on screens and ui: use public entry points (${LAYERS_RULE}).`,
  },
};

// the rules above read the specifier text: "@core/../x" or a node_modules path would slip past them
const CANONICAL_PATHS = {
  regexes: ['(?:^|/)node_modules(?:/|$)', '(?:^|/)(?!\\.\\.(?:/|$))[^/]+/\\.\\.(?:/|$)'],
  message: `import paths are written canonically, with no ".." after a segment and no node_modules path, so layer rules can check them (${LAYERS_RULE}).`,
};

// platform may import core only as types, except typed errors (owner decision)
const PLATFORM_CORE_TYPE_ONLY = {
  regexes: [
    '^@core(?:$|/(?!errors(?:/|$)))',
    '^(?:\\.{1,2}/)+(?:src/)?core(?:$|/(?!errors(?:/|$)))',
  ],
  message: `src/platform imports src/core with "import type" only, except @core/errors (${LAYERS_RULE}).`,
};

// a non-literal import() source would bypass every import rule; metro bundles only literal sources
const LITERAL_IMPORT_GUARD = {
  selector: "ImportExpression:not([source.type='Literal'])",
  message: `import() takes a string literal so layer rules can check it (${LAYERS_RULE}).`,
};

const JIKAN_MESSAGE = `the catalog provider is reached only through its adapter in src/core/catalog/jikan (${LAYERS_RULE}).`;
const JIKAN_GUARDS = [
  { selector: 'Literal[value=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
  { selector: 'TemplateElement[value.raw=/jikan\\.moe/i]', message: JIKAN_MESSAGE },
];

// esquery regex literals cannot contain "/", even escaped
const toSelectorRegex = (regex) => `/${regex.replaceAll('/', '\\x2F')}/i`;

// flat config replaces (never merges) rule options for overlapping files, so each layer gets one
// complete option set for no-restricted-imports and no-restricted-syntax
const layerRules = ({ banned: layerBanned, typeOnly, allowJikan = false }) => {
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
    // static imports are covered above; these guards cover import() calls, always runtime imports
    'no-restricted-syntax': [
      'error',
      LITERAL_IMPORT_GUARD,
      ...[...banned, ...(typeOnly ? [typeOnly] : [])].flatMap(({ regexes, message }) =>
        regexes.map((regex) => ({
          selector: `ImportExpression[source.value=${toSelectorRegex(regex)}]`,
          message,
        })),
      ),
      ...(allowJikan ? [] : JIKAN_GUARDS),
    ],
  };
};

const { reactNative, expo, nativewind, supabase, network, expoInternals } = BANNED;
const LAYERS = [
  {
    files: ['src/core/**'],
    ignores: ['src/core/repositories/supabase/**', 'src/core/catalog/jikan/**'],
    banned: [reactNative, expo, nativewind, supabase],
  },
  {
    files: ['src/core/catalog/jikan/**'],
    banned: [reactNative, expo, nativewind, supabase],
    allowJikan: true,
  },
  { files: ['src/core/repositories/supabase/**'], banned: [reactNative, expo, nativewind] },
  { files: ['src/ui/**'], banned: [supabase, network, expoInternals] },
  {
    files: ['src/platform/**'],
    banned: [nativewind, supabase],
    typeOnly: PLATFORM_CORE_TYPE_ONLY,
  },
  { files: ['src/features/**'], banned: [nativewind, supabase, network, expoInternals] },
  { files: ['app/**'], banned: [nativewind, supabase, network, expoInternals] },
];

// every rule is an error: presets that ship warnings are promoted so editors match --max-warnings 0
const promoteWarnings = (configs) =>
  [configs].flat().map((config) => ({
    ...config,
    ...(config.rules && {
      rules: Object.fromEntries(
        Object.entries(config.rules).map(([name, entry]) => {
          const [severity, ...options] = [entry].flat();
          const isWarning = severity === 'warn' || severity === 1;
          return [name, isWarning ? ['error', ...options] : entry];
        }),
      ),
    }),
  }));

// eslint-plugin-react-hooks owns the hooks rules; drop the @eslint-react copies to avoid double reports
const reactHooksDuplicates = Object.fromEntries(
  Object.keys(eslintReact.configs['disable-conflict-eslint-plugin-react-hooks'].rules)
    .map((name) => name.replace('react-hooks/', ''))
    .filter((name) => name in eslintReact.rules)
    .map((name) => [`@eslint-react/${name}`, 'off']),
);

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

export default defineConfig(
  includeIgnoreFile(ignoreFiles.filter((file, index) => index === 0 || existsSync(file))),
  globalIgnores([
    'supabase/',
    '.husky/',
    '.expo/',
    'expo-env.d.ts',
    'coverage/',
    'android/',
    'ios/',
    'web-build/',
    'dist/',
  ]),

  {
    // eslint-disable comments have no effect: exceptions live only in this file
    linterOptions: { noInlineConfig: true },
  },

  promoteWarnings(js.configs.recommended),
  promoteWarnings(tseslint.configs.strictTypeChecked),
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: ROOT },
    },
  },
  { files: JS_FILES, extends: [tseslint.configs.disableTypeChecked] },

  {
    files: TS_FILES,
    extends: [
      promoteWarnings(eslintReact.configs['strict-type-checked']),
      promoteWarnings(reactHooks.configs.flat.recommended),
    ],
    rules: {
      ...reactHooksDuplicates,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          project: path.join(ROOT, 'tsconfig.json'),
        }),
      ],
    },
    rules: {
      // guard: an unresolved import would silently skip no-restricted-paths
      'import-x/no-unresolved': 'error',
      'import-x/no-default-export': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: ROOT,
          zones: [
            layerZone(
              './src/core',
              ['./src/platform', './src/features', './src/ui', './app'],
              'src/core is platform-agnostic and imports no other layer',
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
            layerZone(
              './src/features',
              ['./app'],
              'app/ is the composition root: nothing imports it',
            ),
            layerZone(
              './src/features',
              IMPLEMENTATION_FOLDERS,
              'src/features uses src/core hooks, never repository or catalog provider implementations',
            ),
            // targets are minimatch globs on absolute paths: every nested file (nested layouts
            // included) and every root file except the root layout itself
            layerZone(
              ['./app/*/**', './app/!(_layout.tsx)'],
              IMPLEMENTATION_FOLDERS,
              'only app/_layout.tsx (the composition root) wires repository and catalog provider implementations',
            ),
          ],
        },
      ],
    },
  },

  {
    // expo-router routes/layouts and tool configs are loaded through their default export
    files: ['app/**', '*.config.{ts,mjs,js,cjs}'],
    rules: { 'import-x/no-default-export': 'off' },
  },

  {
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          // syntax: // @ts-expect-error(#42): upstream type is wrong
          'ts-expect-error': { descriptionFormat: '^\\(#[1-9]\\d*\\): \\S' },
          'ts-ignore': { descriptionFormat: '^\\(#[1-9]\\d*\\): \\S' },
          'ts-nocheck': true,
        },
      ],
      'capitalized-comments': [
        'error',
        'never',
        { ignorePattern: 'TODO|FIXME', ignoreConsecutiveComments: true },
      ],
      'no-restricted-syntax': ['error', ...JIKAN_GUARDS],
    },
  },
  { files: TS_FILES, rules: { '@typescript-eslint/consistent-type-imports': 'error' } },

  ...LAYERS.map(({ files, ignores, ...layer }) => ({
    files,
    ...(ignores && { ignores }),
    rules: layerRules(layer),
  })),

  {
    files: ['app/**', 'src/features/**', 'src/ui/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...NETWORK_GLOBALS.map((name) => ({ name, message: NETWORK_MESSAGE })),
      ],
      // globalThis.fetch(...) and friends would bypass no-restricted-globals
      'no-restricted-properties': [
        'error',
        ...['globalThis', 'window', 'self', 'global'].flatMap((object) =>
          NETWORK_GLOBALS.map((property) => ({ object, property, message: NETWORK_MESSAGE })),
        ),
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreDefaultValues: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          ignoreClassFieldInitialValues: true,
        },
      ],
    },
  },
  {
    files: ['src/ui/theme/**', '**/*.test.{ts,tsx}', '**/__tests__/**', '**/__fixtures__/**'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
);
