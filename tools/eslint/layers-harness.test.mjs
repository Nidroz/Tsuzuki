// tests of the minimatch escaping of the layer test harness (allowDefaultProject globs)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PROBES, literalGlob } from './layers-harness.mjs';

const GLOB_SPECIAL_CHARACTERS = ['[', ']', '(', ')', '*', '?', '!', '+', '@', '{', '}', '\\'];
const BACKSLASH = '\\';

// the escaped globs of the expo-router probe names before the backslash was escaped: kept as is
const EXPO_ROUTER_GLOBS = {
  'app/media/[kind]/[id].tsx': 'app/media/\\[kind\\]/\\[id\\].tsx',
  'app/(tabs)/_layout.tsx': 'app/\\(tabs\\)/_layout.tsx',
  'app/+not-found.tsx': 'app/\\+not-found.tsx',
};

// minimatch reads "\x" as the literal x: unescaping a literal glob gives the file name back
const unescapeGlob = (glob) => glob.replaceAll(/\\(.)/g, '$1');

describe('literalGlob', () => {
  for (const character of GLOB_SPECIAL_CHARACTERS) {
    it(`escapes ${character}`, () => {
      assert.equal(literalGlob(`a${character}b`), `a\\${character}b`);
    });
  }

  it('leaves a path without special characters unchanged', () => {
    assert.equal(literalGlob('src/core/hooks/probe.ts'), 'src/core/hooks/probe.ts');
  });

  it('gives the same globs as before for the expo-router probe names', () => {
    for (const [file, glob] of Object.entries(EXPO_ROUTER_GLOBS)) {
      assert.ok(Object.values(PROBES).includes(file), `${file} must be a probe`);
      assert.equal(literalGlob(file), glob);
    }
  });

  it('gets no backslash from any probe, so every probe glob is unchanged by the backslash escape', () => {
    for (const file of Object.values(PROBES)) {
      assert.equal(file.includes(BACKSLASH), false, `${file} has a backslash`);
    }
  });

  it('escapes a backslash once, before the brackets are escaped', () => {
    const file = 'a\\b[c].ts';
    const glob = literalGlob(file);
    assert.equal(glob, 'a\\\\b\\[c\\].ts');
    assert.equal(unescapeGlob(glob), file);
  });
});
