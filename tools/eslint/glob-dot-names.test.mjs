// tests of withDotNames (tools/eslint/glob-dot-names.mjs): the dot-name variants of the glob targets
// of import-x/no-restricted-paths. path.posix.matchesGlob runs minimatch without the dot option,
// like import-x (windowsPathsNoEscape only turns backslashes into separators), so it reproduces the
// matching of a resolved target on posix paths

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { withDotNames } from './glob-dot-names.mjs';
import { LAYER_ZONES } from './layers.mjs';
import { MESSAGES } from './layers-cases.mjs';

const BASE = '/repo';
const FROM = ['./src/core/catalog/jikan'];
const MESSAGE = 'probe message';
const zone = (target) => ({ target, from: FROM, message: MESSAGE });

// import-x resolves each target and the linted file against the base path
const resolve = (relative) => path.posix.join(BASE, relative);
const matchesZone = ({ target }, file) =>
  [target].flat().some((pattern) => path.posix.matchesGlob(resolve(file), resolve(pattern)));
const findZone = (fragment) => {
  const found = LAYER_ZONES.find(({ message }) => message.includes(fragment));
  assert.ok(found, `no zone with message "${fragment}"`);
  return found;
};

// on windows the resolved target puts a backslash before each segment, which escapes its first
// character: a pattern stays a glob only with a glob character elsewhere
const GLOB_CHARACTER = /[*?[]/;
const SEPARATOR = '/';
const staysGlobAfterSeparators = (pattern) =>
  GLOB_CHARACTER.test(pattern.replaceAll(/\/./g, SEPARATOR));
const globTargets = (zones) =>
  zones.flatMap(({ target }) => [target].flat()).filter((target) => GLOB_CHARACTER.test(target));

describe('withDotNames', () => {
  it('keeps a folder target as is', () => {
    const folder = zone('./src/core');
    assert.deepEqual(withDotNames(folder), folder);
    assert.deepEqual(withDotNames(zone(['./src/ui'])), zone(['./src/ui']));
  });

  it('keeps a glob whose segments all start with a plain character', () => {
    assert.deepEqual(withDotNames(zone('./app/_layout.!(tsx)')), zone('./app/_layout.!(tsx)'));
  });

  it('gives a trailing globstar its dotfile and dot-folder variants', () => {
    assert.deepEqual(withDotNames(zone('./test/core/**')).target, [
      './test/core/**',
      './test/core/**/.*',
      './test/core/**/.*/**/*',
      './test/core/**/.*/**/.*',
      './test/core/**/.*/**/.*/**/*',
      './test/core/**/.*/**/.*/**/.*',
    ]);
  });

  it('gives a segment starting with a glob character a dot name variant', () => {
    assert.deepEqual(withDotNames(zone('./src/core/*.*')).target, [
      './src/core/*.*',
      './src/core/.*',
    ]);
    assert.deepEqual(withDotNames(zone('./app/!(_layout).*')).target, [
      './app/!(_layout).*',
      './app/.*',
    ]);
  });

  it('keeps the original targets first and in order', () => {
    const targets = ['./src/core/*.*', './app/!(_layout).*', './app/_layout.!(tsx)'];
    const variants = withDotNames(zone(targets)).target;
    assert.deepEqual(
      variants.filter((target) => targets.includes(target)),
      targets,
    );
    assert.equal(variants[0], targets[0]);
  });

  it('leaves from and message unchanged', () => {
    const result = withDotNames(zone(['./src/core/*.*', './test/core/**']));
    assert.equal(result.from, FROM);
    assert.equal(result.message, MESSAGE);
    assert.deepEqual(Object.keys(result).sort(), ['from', 'message', 'target']);
  });

  it('keeps every produced pattern a glob after the separators', () => {
    const produced = globTargets([
      withDotNames(zone(['./src/core/*.*', './app/!(_layout).*', './test/core/**'])),
      ...LAYER_ZONES,
    ]);
    assert.ok(produced.length > 0);
    assert.deepEqual(
      produced.filter((pattern) => !staysGlobAfterSeparators(pattern)),
      [],
    );
  });
});

describe('withDotNames on the layer zones', () => {
  it('relies on a globstar that never matches a dot name', () => {
    assert.equal(path.posix.matchesGlob('/repo/src/.a/x.ts', '/repo/src/**'), false);
    assert.equal(path.posix.matchesGlob('/repo/src/.x.ts', '/repo/src/**/*'), false);
  });

  it('covers dotfiles and up to two nested dot-folders outside the implementation folders', () => {
    const coreInterfaces = findZone(MESSAGES.coreInterfaces);
    for (const file of [
      'src/core/hooks/x.ts',
      'src/core/.x.mjs',
      'src/core/.a/x.ts',
      'src/core/hooks/.a/x.mjs',
      'src/core/hooks/.a/.b/x.mjs',
      'src/core/catalog/.x.ts',
      'src/core/repositories/.cache/x.ts',
      'test/core/.a/.b/x.ts',
    ]) {
      assert.equal(matchesZone(coreInterfaces, file), true, file);
    }
  });

  it('leaves the dot names inside the implementation folders out', () => {
    const coreInterfaces = findZone(MESSAGES.coreInterfaces);
    for (const file of [
      'src/core/catalog/jikan/x.ts',
      'src/core/catalog/jikan/.x.mjs',
      'src/core/repositories/local/.cache/x.ts',
      'src/core/repositories/supabase/.a/.b/x.ts',
    ]) {
      assert.equal(matchesZone(coreInterfaces, file), false, file);
    }
  });

  it('keeps a colocated test in a dot-folder out of the production code zone', () => {
    const testInfrastructure = findZone(MESSAGES.testInfrastructure);
    assert.equal(matchesZone(testInfrastructure, 'src/features/.a/x.ts'), true);
    assert.equal(matchesZone(testInfrastructure, 'src/features/.a/x.test.ts'), false);
    assert.equal(matchesZone(testInfrastructure, 'app/.a/.b/x.tsx'), true);
  });
});
