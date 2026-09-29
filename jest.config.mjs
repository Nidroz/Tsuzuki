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

// tsc rejects a "paths" pattern or target with more than one wildcard: such an entry fails here
// too, so every wildcard replaced below is the only one of its entry
const WILDCARD = '*';

const withOneWildcardAtMost = (entry) => {
  if (entry.split(WILDCARD).length > 2) {
    throw new Error(
      `tsconfig.json paths entry "${entry}" has more than one "${WILDCARD}": tsconfig allows one at most`,
    );
  }
  return entry;
};

// tsconfig "paths" as jest moduleNameMapper entries: "@core/*" -> "<rootDir>/src/core/$1"
export const aliasesFromPaths = (paths) =>
  Object.fromEntries(
    Object.entries(paths).map(([alias, targets]) => [
      `^${withOneWildcardAtMost(alias)
        .replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replaceAll(WILDCARD, '(.*)')}$`,
      targets.map(
        (target) =>
          `<rootDir>/${path.posix.normalize(withOneWildcardAtMost(target)).replaceAll(WILDCARD, '$1')}`,
      ),
    ]),
  );

const aliasesFromTsconfig = () => {
  const tsconfigPath = path.join(ROOT, 'tsconfig.json');
  const { config, error } = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (error) {
    throw new Error(ts.flattenDiagnosticMessageText(error.messageText, '\n'));
  }
  return aliasesFromPaths(config.compilerOptions?.paths ?? {});
};

// test files of each project, relative to the root. testMatch is built from these lists and the
// guard below checks every test file against the same lists, so the two cannot drift
const CORE_TESTS = ['src/core/**/*.test.{ts,tsx}', 'test/core/**/*.test.{ts,tsx}'];
const MOBILE_TESTS = [
  'src/{features,ui,platform}/**/*.test.{ts,tsx}',
  'test/app/**/*.test.{ts,tsx}',
  'test/mobile/**/*.test.{ts,tsx}',
];
const PROJECT_TESTS = { core: CORE_TESTS, mobile: MOBILE_TESTS };
const TEST_ROOTS = ['app', 'src', 'test'];
const TEST_FILE = /\.test\.tsx?$/;

const toTestMatch = (patterns) => patterns.map((pattern) => `<rootDir>/${pattern}`);

// root-relative paths with forward slashes, as the patterns above are written
const filesUnder = (root) =>
  readdirSync(path.join(ROOT, root), { recursive: true }).map((entry) =>
    path.posix.join(root, ...String(entry).split(path.sep)),
  );

const projectsRunning = (file) =>
  Object.entries(PROJECT_TESTS)
    .filter(([, patterns]) => patterns.some((pattern) => path.posix.matchesGlob(file, pattern)))
    .map(([name]) => name);

// a test file outside every project would never run, and one inside both would run twice:
// either case fails the whole run here instead. matchesGlob skips dot folders, so a test under
// one is reported too: that errs on the loud side
const assertEveryTestInOneProject = () => {
  const misplaced = TEST_ROOTS.flatMap(filesUnder).filter(
    (file) => TEST_FILE.test(file) && projectsRunning(file).length !== 1,
  );
  if (misplaced.length > 0) {
    const projects = Object.entries(PROJECT_TESTS).map(
      ([name, patterns]) => `${name}: ${patterns.join(', ')}`,
    );
    throw new Error(
      `test files outside exactly one jest project: ${misplaced.join(', ')}. ` +
        `move them under one project's paths (${projects.join('; ')})`,
    );
  }
};
assertEveryTestInOneProject();

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
      testMatch: toTestMatch(CORE_TESTS),
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
      testMatch: toTestMatch(MOBILE_TESTS),
      setupFilesAfterEnv: ['<rootDir>/test/mobile/setup.ts'],
    },
  ],
};

export default config;
