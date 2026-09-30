// regression tests for the layer rules of eslint.config.mjs (CONTRIBUTING.md section 4)

import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as classNameCases from './layers-class-name-cases.mjs';
import * as layerCases from './layers-cases.mjs';
import * as dotfileCases from './layers-dotfile-cases.mjs';
import * as i18nCases from './layers-i18n-cases.mjs';
import * as jestCases from './layers-jest-cases.mjs';
import * as jestChainCases from './layers-jest-chain-cases.mjs';
import * as networkCases from './layers-network-cases.mjs';
import * as styleCases from './layers-style-cases.mjs';
import * as testCodeCases from './layers-test-code-cases.mjs';
import * as textCases from './layers-text-cases.mjs';
import * as uiBarrelCases from './layers-ui-barrel-cases.mjs';
import {
  EXISTING,
  PROBES,
  ROOT,
  assertNoLayerViolation,
  assertReported,
  guardEslint,
  hybridResolver,
  layersEslint,
  lint,
} from './layers-harness.mjs';

const { APP_INDEX_FROM_SRC_LAYER, MESSAGES, valueImport } = layerCases;
// the case tables, split by topic; a group name is unique across tables
const TABLES = [
  layerCases,
  networkCases,
  testCodeCases,
  jestCases,
  jestChainCases,
  classNameCases,
  styleCases,
  uiBarrelCases,
  i18nCases,
  textCases,
  dotfileCases,
];
const groups = (table) => TABLES.flatMap((cases) => Object.entries(cases[table]));

describe('layer rules: rejected', () => {
  for (const [group, cases] of groups('REJECTED')) {
    describe(group, () => {
      for (const { name, file, code, ruleId, fragment } of cases) {
        it(name, async () => {
          assertReported(await lint(layersEslint, file, code), ruleId, fragment);
        });
      }
    });
  }
});

describe('layer rules: allowed (positive controls)', () => {
  for (const [group, cases] of groups('ALLOWED')) {
    describe(group, () => {
      for (const { name, file, code } of cases) {
        it(name, async () => {
          assertNoLayerViolation(await lint(layersEslint, file, code));
        });
      }
    });
  }
});

describe('test harness', () => {
  it('names every case group once per table', () => {
    for (const table of ['REJECTED', 'ALLOWED']) {
      const names = groups(table).map(([group]) => group);
      assert.deepEqual(names, [...new Set(names)], `duplicate ${table} group`);
    }
  });

  it('uses every probe in at least one case', () => {
    const files = new Set(
      [...groups('REJECTED'), ...groups('ALLOWED')].flatMap(([, cases]) =>
        cases.map(({ file }) => file),
      ),
    );
    const unused = [...Object.values(PROBES), ...Object.values(EXISTING)].filter(
      (file) => !files.has(file),
    );
    assert.deepEqual(unused, []);
  });

  it('resolves the test infrastructure in test/ to real files', () => {
    const source = path.join(ROOT, PROBES.features);
    assert.deepEqual(hybridResolver.resolve('../../test/mobile/render-router', source), {
      found: true,
      path: path.join(ROOT, 'test', 'mobile', 'render-router.ts'),
    });
  });

  it('resolves aliases and relative paths in src/ and app/ to synthetic targets', () => {
    const source = path.join(ROOT, PROBES.hooks);
    assert.deepEqual(hybridResolver.resolve('@core/repositories/local/x', source), {
      found: true,
      path: path.join(ROOT, 'src', 'core', 'repositories', 'local', 'x.ts'),
    });
    assert.deepEqual(hybridResolver.resolve('../catalog/jikan/x', source), {
      found: true,
      path: path.join(ROOT, 'src', 'core', 'catalog', 'jikan', 'x.ts'),
    });
  });

  it('prefers real modules and leaves other specifiers unresolved', () => {
    const source = path.join(ROOT, PROBES.features);
    assert.deepEqual(hybridResolver.resolve(APP_INDEX_FROM_SRC_LAYER, source), {
      found: true,
      path: path.join(ROOT, 'app', 'index.tsx'),
    });
    assert.deepEqual(hybridResolver.resolve('react-native-foo', source), { found: false });
    assert.deepEqual(hybridResolver.resolve('../../tools/x', source), { found: false });
  });

  describe('real resolver, no override', () => {
    it('reports a missing module with import-x/no-unresolved', async () => {
      const messages = await lint(
        guardEslint,
        PROBES.features,
        valueImport('@core/does-not-exist'),
      );
      assertReported(messages, 'import-x/no-unresolved', '@core/does-not-exist');
    });

    it('does not report an existing module', async () => {
      const messages = await lint(guardEslint, PROBES.features, valueImport('react'));
      const unresolved = messages.filter(({ ruleId }) => ruleId === 'import-x/no-unresolved');
      assert.deepEqual(unresolved, []);
    });

    it('applies the zones to existing modules', async () => {
      const messages = await lint(
        guardEslint,
        PROBES.features,
        valueImport(APP_INDEX_FROM_SRC_LAYER),
      );
      assertReported(messages, 'import-x/no-restricted-paths', MESSAGES.app);
    });
  });
});
