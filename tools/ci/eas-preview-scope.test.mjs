import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import {
  BUILD_PATHS,
  IGNORED_PATHS,
  MIGRATION_PATHS,
  classifyChanges,
  formatOutputs,
  globToRegExp,
} from './eas-preview-scope.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'eas-preview.yml');
const CLI = path.join(import.meta.dirname, 'check-eas-preview-scope.mjs');
const FAILURE_EXIT_CODE = 1;

// the quoted entries of the first `paths:` list of the workflow (on.push.paths), in order
const workflowPushPaths = () => {
  const lines = readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'paths:');
  assert.notEqual(start, -1, 'no paths list in the workflow');
  const entries = [];
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (text.startsWith('#')) continue;
    const entry = /^- '([^']+)'$/.exec(text);
    if (entry === null) break;
    entries.push(entry[1]);
  }
  return entries;
};

describe('classifyChanges', () => {
  it('builds when a file of the app bundle or its native config changed', () => {
    for (const file of [
      'src/core/domain/progress.ts',
      'app/_layout.tsx',
      'eas.json',
      'tools/expo/eas-update.mjs',
    ]) {
      assert.deepEqual(classifyChanges(['docs/BACKLOG.md', file]), { build: true }, file);
    }
  });

  it('does not build for docs and tests under the build paths', () => {
    assert.deepEqual(
      classifyChanges([
        'src/platform/README.md',
        'src/platform/sentry-scrub.test.ts',
        'src/ui/components/Button.test.tsx',
        'tools/expo/eas-update.test.mjs',
      ]),
      { build: false },
    );
  });

  it('does not build for a migration-only change', () => {
    assert.deepEqual(classifyChanges(['supabase/migrations/20261012000000_items.sql']), {
      build: false,
    });
  });

  it('does not build for ci-only changes', () => {
    assert.deepEqual(
      classifyChanges(['.github/workflows/eas-preview.yml', 'tools/ci/eas-preview-scope.mjs']),
      { build: false },
    );
  });

  it('skips blank entries and trims the names', () => {
    assert.deepEqual(classifyChanges(['', '   ', '\n']), { build: false });
    assert.deepEqual(classifyChanges(['  src/core/index.ts\r']), { build: true });
  });
});

describe('globToRegExp', () => {
  it('matches a leading **/ in any folder, the root included', () => {
    const markdown = globToRegExp('**/*.md');
    assert.ok(markdown.test('README.md'));
    assert.ok(markdown.test('docs/adr/0012-environments-and-app-variants.md'));
    assert.ok(!markdown.test('README.mdx'));
  });

  it('matches a trailing /** below the folder only', () => {
    const source = globToRegExp('src/**');
    assert.ok(source.test('src/core/a.ts'));
    assert.ok(!source.test('src'));
    assert.ok(!source.test('srcx/a.ts'));
  });

  it('keeps * inside one folder and the dots literal', () => {
    assert.ok(!globToRegExp('*.ts').test('src/a.ts'));
    assert.ok(!globToRegExp('app.config.ts').test('appxconfig.ts'));
  });
});

describe('formatOutputs', () => {
  it('writes the build output only', () => {
    assert.equal(formatOutputs({ build: true }), 'build=true\n');
    assert.equal(formatOutputs({ build: false }), 'build=false\n');
  });
});

describe('eas-preview workflow push paths', () => {
  it('repeat the scope lists in order, the ignored paths negated', () => {
    assert.deepEqual(workflowPushPaths(), [
      ...MIGRATION_PATHS,
      ...BUILD_PATHS,
      ...IGNORED_PATHS.map((glob) => `!${glob}`),
    ]);
  });
});

describe('check-eas-preview-scope cli', () => {
  it('fails without GITHUB_OUTPUT', () => {
    const result = spawnSync(process.execPath, [CLI], {
      cwd: ROOT,
      encoding: 'utf8',
      input: '',
      env: { ...process.env, GITHUB_OUTPUT: '', FORCE_ALL: 'true' },
    });
    assert.equal(result.status, FAILURE_EXIT_CODE);
    assert.equal(result.stderr, '::error::GITHUB_OUTPUT is not set\n');
  });
});
