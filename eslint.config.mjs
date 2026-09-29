import { existsSync } from 'node:fs';
import path from 'node:path';

import js from '@eslint/js';
import eslintReact from '@eslint-react/eslint-plugin';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import jestPlugin from 'eslint-plugin-jest';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import tseslint from 'typescript-eslint';

import {
  BASE_SYNTAX_GUARDS,
  LAYER_ZONES,
  LAYERS,
  NETWORK_GLOBALS,
  NETWORK_MESSAGE,
  SRC_OUTSIDE_LAYERS,
  layerRules,
} from './tools/eslint/layers.mjs';
import { tsuzukiPlugin } from './tools/eslint/plugin/index.mjs';
import {
  TEST_HYGIENE_PROPERTIES,
  TEST_HYGIENE_SYNTAX,
  TOOLING_TEST_FILES,
} from './tools/eslint/test-hygiene.mjs';

const ROOT = import.meta.dirname;
const TS_FILES = ['**/*.{ts,tsx}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
// jest tests only: the node:test tooling tests (*.test.mjs) get no jest rules
const JEST_FILES = ['**/*.test.{ts,tsx}'];
// matches the installed jest major, so version-dependent rules skip auto-detection
const JEST_VERSION = 29;
// a ts directive must cite a backlog id from docs/BACKLOG.md, e.g. (F-05)
const TS_DIRECTIVE_FORMAT = '^\\([A-Z]-\\d{2}\\): \\S';

// ignore patterns are resolved against this config's folder (the repo root), not the ignore file's
const ignoreFiles = [path.join(ROOT, '.gitignore'), path.join(ROOT, '.git', 'info', 'exclude')];

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

// the jest presets also declare jest globals: tests import them from @jest/globals instead
const jestRulesOnly = ({ plugins, rules }) => ({ plugins, rules });

// eslint-plugin-react-hooks owns the hooks rules; drop the @eslint-react copies to avoid double reports
const reactHooksDuplicates = Object.fromEntries(
  Object.keys(eslintReact.configs['disable-conflict-eslint-plugin-react-hooks'].rules)
    .map((name) => name.replace('react-hooks/', ''))
    .filter((name) => name in eslintReact.rules)
    .map((name) => [`@eslint-react/${name}`, 'off']),
);

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
          zones: LAYER_ZONES,
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
          // syntax: // @ts-expect-error(F-05): upstream type is wrong (a backlog id from docs/BACKLOG.md)
          'ts-expect-error': { descriptionFormat: TS_DIRECTIVE_FORMAT },
          'ts-ignore': { descriptionFormat: TS_DIRECTIVE_FORMAT },
          'ts-nocheck': true,
        },
      ],
      'capitalized-comments': [
        'error',
        'never',
        { ignorePattern: 'TODO|FIXME', ignoreConsecutiveComments: true },
      ],
      'no-restricted-syntax': ['error', ...BASE_SYNTAX_GUARDS],
    },
  },
  { files: TS_FILES, rules: { '@typescript-eslint/consistent-type-imports': 'error' } },

  {
    // project rules from tools/eslint/plugin: backlog ids in work markers and ts directives, and
    // file naming (CONTRIBUTING.md section 5)
    plugins: { tsuzuki: tsuzukiPlugin },
    rules: {
      'tsuzuki/backlog-reference': 'error',
      'tsuzuki/file-name-case': 'error',
    },
  },

  ...LAYERS.map(({ files, ignores, ...layer }) => ({
    files,
    ...(ignores && { ignores }),
    rules: layerRules(layer),
  })),
  SRC_OUTSIDE_LAYERS,

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

  {
    // leaves the layer import rules alone: each layer keeps its complete option set
    files: JEST_FILES,
    extends: [
      promoteWarnings(jestRulesOnly(jestPlugin.configs['flat/recommended'])),
      promoteWarnings(jestRulesOnly(jestPlugin.configs['flat/style'])),
    ],
    settings: { jest: { version: JEST_VERSION } },
    rules: {
      'jest/prefer-importing-jest-globals': 'error',
      'jest/no-disabled-tests': 'error',
      'jest/no-focused-tests': 'error',
      // the jest variant understands jest.fn() and expect(obj.method) calls
      '@typescript-eslint/unbound-method': 'off',
      'jest/unbound-method': 'error',
      // a test is never a route or a tool config: overrides the app/** exception above
      'import-x/no-default-export': 'error',
    },
  },

  {
    // test hygiene of the node:test tooling suites (tools/eslint/test-hygiene.mjs); the
    // no-restricted-syntax options replace the base ones here: the base guards are re-included
    files: TOOLING_TEST_FILES,
    rules: {
      'no-restricted-properties': ['error', ...TEST_HYGIENE_PROPERTIES],
      'no-restricted-syntax': ['error', ...BASE_SYNTAX_GUARDS, ...TEST_HYGIENE_SYNTAX],
    },
  },
);
