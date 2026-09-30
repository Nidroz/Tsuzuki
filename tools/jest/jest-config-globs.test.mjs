// tests of the testMatch and collectCoverageFrom globs of jest.config.mjs, read the way jest 29
// reads them. importing the config runs its top level (see jest-config.test.mjs): node:test runs
// each test file in its own process, so nothing leaks into the other tooling suites

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import config, { isCoveredSource } from '../../jest.config.mjs';

const ROOT_DIR_TAG = '<rootDir>';
const ROOTS = { posix: '/repo', win32: 'C:\\repo' };
// jest-util 29 replacePathSepForGlob: a backslash turns into a slash, except before one of these
// characters, where it stays and escapes it
const REPLACED_BACKSLASH = /\\(?![{}()+?.^$])/g;
const NEGATION = '!';

// jest-config 29 normalize: <rootDir> is resolved with the platform path module (path.normalize
// turns every slash into a backslash on windows), then replacePathSepForGlob runs. replayed with
// path.posix and path.win32, so the windows handling is checked on linux ci as well
const jestGlob = (platform, pattern) => {
  const pathModule = path[platform];
  const resolved = pattern.startsWith(ROOT_DIR_TAG)
    ? pathModule.resolve(
        ROOTS[platform],
        pathModule.normalize(`./${pattern.slice(ROOT_DIR_TAG.length)}`),
      )
    : pattern;
  return resolved.replace(REPLACED_BACKSLASH, '/');
};

// jest matches an absolute path with its separators turned into slashes. its picomatch reads a
// kept backslash as an escape (src\{ui} only matches a literal "{ui}" folder) while
// path.matchesGlob reads it as a separator: the escapes are caught by the backslash test above,
// and the sample test below checks which project runs each file
const absoluteTestPath = (platform, file) =>
  jestGlob(platform, `${ROOT_DIR_TAG}/${file}`).replaceAll('\\', '/');

const projectOf = (name) => {
  const project = config.projects.find(({ displayName }) => displayName === name);
  assert.ok(project, `jest project "${name}" must exist`);
  return project;
};

const testMatchOf = (name) => projectOf(name).testMatch;

// core tests are split by extension: .ts in node, .tsx (react rendering) in jsdom
const PROJECT_SAMPLES = {
  core: ['src/core/a.test.ts', 'src/core/domain/b.test.ts', 'test/core/c.test.ts'],
  'core-dom': ['src/core/i18n/A.test.tsx', 'src/core/hooks/use-b.test.tsx', 'test/core/c.test.tsx'],
  mobile: [
    'src/features/search/a.test.tsx',
    'src/ui/a.test.tsx',
    'src/ui/components/b.test.ts',
    'src/platform/c.test.ts',
    'test/app/d.test.tsx',
    'test/mobile/e.test.ts',
  ],
};

describe('testMatch', () => {
  for (const platform of Object.keys(ROOTS)) {
    it(`leaves no escaping backslash in any pattern once jest normalizes it (${platform})`, () => {
      for (const name of Object.keys(PROJECT_SAMPLES)) {
        for (const pattern of testMatchOf(name)) {
          const glob = jestGlob(platform, pattern);
          assert.equal(glob.includes('\\'), false, `${name}: ${pattern} becomes ${glob}`);
        }
      }
    });

    it(`runs every sample test in its own project only (${platform})`, () => {
      for (const [expected, files] of Object.entries(PROJECT_SAMPLES)) {
        for (const file of files) {
          const running = Object.keys(PROJECT_SAMPLES).filter((name) =>
            testMatchOf(name).some((pattern) =>
              path.posix.matchesGlob(absoluteTestPath(platform, file), jestGlob(platform, pattern)),
            ),
          );
          assert.deepEqual(running, [expected], `${file} on ${platform}`);
        }
      }
    });
  }
});

// a .tsx core test renders react in jsdom, without the msw/node server that does not load there
describe('core projects', () => {
  it('runs .ts core tests in node with the msw setup', () => {
    const core = projectOf('core');
    assert.equal(core.testEnvironment, 'node');
    assert.deepEqual(core.setupFilesAfterEnv, ['<rootDir>/test/core/setup.ts']);
  });

  it('runs .tsx core tests in jsdom with the setup that stubs the network', () => {
    const coreDom = projectOf('core-dom');
    assert.equal(coreDom.testEnvironment, 'jsdom');
    assert.deepEqual(coreDom.setupFilesAfterEnv, ['<rootDir>/test/core/setup-dom.ts']);
  });

  it('gives both the same transform, aliases and determinism options, without a preset', () => {
    const core = projectOf('core');
    const coreDom = projectOf('core-dom');
    for (const option of [
      'transform',
      'transformIgnorePatterns',
      'moduleNameMapper',
      'fakeTimers',
      'restoreMocks',
    ]) {
      assert.deepEqual(coreDom[option], core[option], option);
      assert.notEqual(core[option], undefined, option);
    }
    assert.equal(core.preset, undefined);
    assert.equal(coreDom.preset, undefined);
  });
});

// jest 29 reads testTimeout from the root config only: set in a project, it is silently ignored
const JEST_DEFAULT_TIMEOUT_MS = 5000;

describe('testTimeout', () => {
  it('is set at the root, above the 5 s default, and in no project', () => {
    assert.equal(typeof config.testTimeout, 'number');
    assert.ok(config.testTimeout > JEST_DEFAULT_TIMEOUT_MS, `testTimeout is ${config.testTimeout}`);
    for (const { displayName, testTimeout } of config.projects) {
      assert.equal(testTimeout, undefined, displayName);
    }
  });
});

// jest instruments a file when it matches a positive pattern and no negated one
const coveredByGlobs = (file) => {
  const positives = config.collectCoverageFrom.filter((glob) => !glob.startsWith(NEGATION));
  const negatives = config.collectCoverageFrom
    .filter((glob) => glob.startsWith(NEGATION))
    .map((glob) => glob.slice(NEGATION.length));
  return (
    positives.some((glob) => path.posix.matchesGlob(file, glob)) &&
    !negatives.some((glob) => path.posix.matchesGlob(file, glob))
  );
};

const COVERED = [
  'app/index.tsx',
  'app/(tabs)/_layout.tsx',
  'src/core/domain/progress.ts',
  'src/ui/components/Button.tsx',
  'src/platform/storage.ts',
];
const NOT_COVERED = [
  'src/ui/theme/tailwind.config.ts',
  'src/features/x.config.tsx',
  'src/ui/theme/global.css',
  'src/ui/nativewind-env.d.ts',
  'src/core/a.test.ts',
  'src/ui/b.test.tsx',
  'src/core/__tests__/a.ts',
  'src/core/__fixtures__/a.ts',
  'src/core/__mocks__/a.ts',
  'test/core/fixed-clock.ts',
];

describe('collectCoverageFrom', () => {
  it('covers app and src source files', () => {
    for (const file of COVERED) {
      assert.equal(coveredByGlobs(file), true, file);
    }
  });

  it('skips tests, fixtures, mocks, declarations, tool configs and files outside app and src', () => {
    for (const file of NOT_COVERED) {
      assert.equal(coveredByGlobs(file), false, file);
    }
  });

  it('agrees with isCoveredSource, which decides whether src/core has a threshold', () => {
    for (const file of [...COVERED, ...NOT_COVERED].filter((name) => name.startsWith('src/'))) {
      assert.equal(isCoveredSource(file), coveredByGlobs(file), file);
      assert.equal(isCoveredSource(file.replaceAll('/', '\\')), coveredByGlobs(file), file);
    }
  });
});
