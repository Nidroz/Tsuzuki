// regression tests for the layer rules of eslint.config.mjs (CONTRIBUTING.md section 4)

import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED,
  APP_INDEX_FROM_SRC_LAYER,
  MESSAGES,
  REJECTED,
  valueImport,
} from './layers-cases.mjs';
import {
  PROBES,
  ROOT,
  assertNoLayerViolation,
  assertReported,
  guardEslint,
  hybridResolver,
  layersEslint,
  lint,
} from './layers-harness.mjs';

describe('layer rules: rejected', () => {
  for (const [group, cases] of Object.entries(REJECTED)) {
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
  for (const [group, cases] of Object.entries(ALLOWED)) {
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
