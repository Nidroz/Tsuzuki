// tests of the minimatch escaping of the layer test harness (allowDefaultProject globs)

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { EXISTING, PROBES, ROOT, literalGlob } from './layers-harness.mjs';

const GLOB_SPECIAL_CHARACTERS = ['[', ']', '(', ')', '*', '?', '!', '+', '@', '{', '}', '\\'];
const BACKSLASH = '\\';

// the escaped globs of the expo-router shaped probe names
const EXPO_ROUTER_GLOBS = {
  'app/probe/[kind]/[id].tsx': 'app/probe/\\[kind\\]/\\[id\\].tsx',
  'app/(probe)/_layout.tsx': 'app/\\(probe\\)/_layout.tsx',
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

  it('escapes the expo-router probe names', () => {
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

// typescript-eslint rejects a file matched by allowDefaultProject that is also in the project: a
// probe that became a real file fails every case linting it, a missing existing file lints nothing
describe('probe and existing files', () => {
  it('lists probes that do not exist on disk', () => {
    const onDisk = Object.values(PROBES).filter((file) => existsSync(path.join(ROOT, file)));
    assert.deepEqual(onDisk, []);
  });

  it('lists existing files that exist on disk', () => {
    const missing = Object.values(EXISTING).filter((file) => !existsSync(path.join(ROOT, file)));
    assert.deepEqual(missing, []);
  });
});
