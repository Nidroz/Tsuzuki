// tests of the tsconfig "paths" to jest moduleNameMapper mapping of jest.config.mjs.
// importing the config runs its top level: it sets process.env.TZ, reads src/core and checks every
// test file's project. node:test runs each test file in its own process, so nothing leaks into
// the other tooling suites

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import ts from 'typescript';

import { aliasesFromPaths } from '../../jest.config.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const TSCONFIG_REFERENCE = /tsconfig/;

// the mapper built from tsconfig.json before the multi-wildcard guard: kept byte for byte
const REAL_ALIASES = {
  '^@core/(.*)$': ['<rootDir>/src/core/$1'],
  '^@features/(.*)$': ['<rootDir>/src/features/$1'],
  '^@ui/(.*)$': ['<rootDir>/src/ui/$1'],
  '^@platform/(.*)$': ['<rootDir>/src/platform/$1'],
};

// read the same way as jest.config.mjs does
const readTsconfigPaths = () => {
  const { config, error } = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  assert.equal(error, undefined, 'tsconfig.json must be readable');
  return config.compilerOptions?.paths ?? {};
};

describe('aliasesFromPaths', () => {
  it('maps the tsconfig.json aliases exactly as before, in the same order', () => {
    const aliases = aliasesFromPaths(readTsconfigPaths());
    assert.deepEqual(aliases, REAL_ALIASES);
    // jest tries moduleNameMapper entries in order
    assert.deepEqual(Object.keys(aliases), Object.keys(REAL_ALIASES));
  });

  it('maps no paths to no aliases', () => {
    assert.deepEqual(aliasesFromPaths({}), {});
  });

  it('escapes regex metacharacters in an alias', () => {
    assert.deepEqual(aliasesFromPaths({ '@a.b/*': ['./src/ab/*'] }), {
      '^@a\\.b/(.*)$': ['<rootDir>/src/ab/$1'],
    });
  });

  it('escapes every regex metacharacter, so the pattern matches the alias literally', () => {
    const literal = '.+?^${}()|[]\\';
    const [pattern] = Object.keys(aliasesFromPaths({ [`${literal}/*`]: ['./src/x/*'] }));
    assert.equal(pattern, '^\\.\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\/(.*)$');
    const regex = new RegExp(pattern ?? '');
    assert.equal(regex.exec(`${literal}/module`)?.[1], 'module');
    assert.equal(regex.test('a/module'), false);
  });

  it('maps an alias without a wildcard literally', () => {
    assert.deepEqual(aliasesFromPaths({ '@env': ['./src/env.ts'] }), {
      '^@env$': ['<rootDir>/src/env.ts'],
    });
  });

  it('normalizes each target under <rootDir>, in order', () => {
    assert.deepEqual(aliasesFromPaths({ '@x/*': ['./src/x/*', 'src//y/./z/../*'] }), {
      '^@x/(.*)$': ['<rootDir>/src/x/$1', '<rootDir>/src/y/$1'],
    });
  });

  it('throws on an alias with more than one wildcard, naming it and citing tsconfig', () => {
    assert.throws(
      () => aliasesFromPaths({ '@a/*/*': ['./src/a/*'] }),
      (error) =>
        error instanceof Error &&
        error.message.includes('"@a/*/*"') &&
        TSCONFIG_REFERENCE.test(error.message),
    );
  });

  it('throws on a target with more than one wildcard, naming it and citing tsconfig', () => {
    assert.throws(
      () => aliasesFromPaths({ '@a/*': ['./src/a/*', './src/*/b/*'] }),
      (error) =>
        error instanceof Error &&
        error.message.includes('"./src/*/b/*"') &&
        TSCONFIG_REFERENCE.test(error.message),
    );
  });
});
