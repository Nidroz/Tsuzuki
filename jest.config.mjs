import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const ROOT = import.meta.dirname;
const require = createRequire(import.meta.url);

// every date is computed in UTC. set here, before any worker starts: workers inherit the
// environment, and node applies a TZ change immediately in this process (used by --runInBand).
// a globalSetup module would need a default export, which the lint rules forbid outside configs
const TIME_ZONE = 'UTC';
process.env.TZ = TIME_ZONE;

const CORE_DIR = 'src/core';
const CORE_LINES_THRESHOLD = 90;
const CORE_BRANCHES_THRESHOLD = 90;
const GLOBAL_LINES_THRESHOLD = 70;

const SOURCE_EXTENSION = /\.tsx?$/;
const EXCLUDED_FILE = /\.(?:test\.tsx?|d\.ts)$/;
const EXCLUDED_FOLDERS = new Set(['__tests__', '__fixtures__', '__mocks__']);

// keep in sync with isCoveredSource below
const collectCoverageFrom = [
  'app/**/*.{ts,tsx}',
  'src/**/*.{ts,tsx}',
  '!**/*.test.{ts,tsx}',
  '!**/__tests__/**',
  '!**/__fixtures__/**',
  '!**/__mocks__/**',
  '!**/*.d.ts',
];

const isCoveredSource = (relativePath) => {
  const segments = relativePath.split(/[\\/]/);
  const fileName = segments.at(-1) ?? '';
  return (
    SOURCE_EXTENSION.test(fileName) &&
    !EXCLUDED_FILE.test(fileName) &&
    !segments.some((segment) => EXCLUDED_FOLDERS.has(segment))
  );
};

// jest fails with "Coverage data for ./src/core/ was not found" when a threshold path matches no
// file, and src/core only holds READMEs until its first source file lands. that first file turns
// the group on and counts at 0 % until it is tested
const hasCoreSource = readdirSync(path.join(ROOT, CORE_DIR), { recursive: true }).some((entry) =>
  isCoveredSource(String(entry)),
);

const coverageThreshold = {
  global: { lines: GLOBAL_LINES_THRESHOLD },
  ...(hasCoreSource && {
    [`./${CORE_DIR}/`]: { lines: CORE_LINES_THRESHOLD, branches: CORE_BRANCHES_THRESHOLD },
  }),
};

// tsconfig "paths" as jest moduleNameMapper entries: "@core/*" -> "<rootDir>/src/core/$1"
const aliasesFromTsconfig = () => {
  const tsconfigPath = path.join(ROOT, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  const paths = config.compilerOptions?.paths ?? {};
  return Object.fromEntries(
    Object.entries(paths).map(([alias, targets]) => [
      `^${alias.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replace('*', '(.*)')}$`,
      targets.map((target) => `<rootDir>/${path.posix.normalize(target).replace('*', '$1')}`),
    ]),
  );
};

// the app's babel transform (expo preset, as metro runs it), without the react native preset
const expoPreset = require('jest-expo/jest-preset');
const BABEL_PATTERN = '\\.[jt]sx?$';
const babelTransform = expoPreset.transform[BABEL_PATTERN];
if (!babelTransform) {
  throw new Error(`jest-expo no longer transforms ${BABEL_PATTERN}: update the core project`);
}

// jest 29 cannot require native esm: esm-only dependencies of msw are transformed to commonjs
const CORE_ESM_DEPENDENCIES = ['@open-draft/deferred-promise', 'rettime', 'until-async'];

const shared = {
  rootDir: ROOT,
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  // every timer api and the clock are fake (msw and react native testing library run with them);
  // the setup files pin the clock and reset timers before each test (test/core/fixed-clock.ts)
  fakeTimers: { enableGlobally: true },
  restoreMocks: true,
  errorOnDeprecated: true,
};

/** @type {import('jest').Config} */
const config = {
  // test order within each file is shuffled with a seed printed in the summary (--seed replays it)
  randomize: true,
  collectCoverageFrom,
  coverageThreshold,
  coverageReporters: ['text-summary', 'text', 'lcov'],
  projects: [
    {
      ...shared,
      displayName: 'core',
      // node export conditions: msw/node resolves, and a react native import fails at runtime
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/src/core/**/*.test.{ts,tsx}',
        '<rootDir>/test/core/**/*.test.{ts,tsx}',
      ],
      transform: { '\\.(?:[jt]sx?|mjs)$': babelTransform },
      // pnpm stores packages under node_modules/.pnpm/<name>@<version>/node_modules/<name>
      transformIgnorePatterns: [
        `/node_modules/(?!(?:\\.pnpm|${CORE_ESM_DEPENDENCIES.join('|')})/)`,
      ],
      moduleNameMapper: aliasesFromTsconfig(),
      setupFilesAfterEnv: ['<rootDir>/test/core/setup.ts'],
    },
    {
      ...shared,
      displayName: 'mobile',
      preset: 'jest-expo',
      testMatch: [
        '<rootDir>/src/{features,ui,platform}/**/*.test.{ts,tsx}',
        '<rootDir>/test/app/**/*.test.{ts,tsx}',
        '<rootDir>/test/mobile/**/*.test.{ts,tsx}',
      ],
      setupFilesAfterEnv: ['<rootDir>/test/mobile/setup.ts'],
    },
  ],
};

export default config;
