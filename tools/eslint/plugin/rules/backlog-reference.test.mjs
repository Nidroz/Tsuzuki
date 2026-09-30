// regression tests for tsuzuki/backlog-reference with eslint's RuleTester (CONTRIBUTING.md section 5)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Linter, RuleTester } from 'eslint';

import { tsuzukiPlugin } from '../index.mjs';
import { backlogReference } from './backlog-reference.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
// backlog paths are resolved against the eslint cwd, the repo root under `pnpm test:tooling`
const FIXTURE = 'tools/eslint/plugin/__fixtures__/backlog.md';
const MISSING = 'tools/eslint/plugin/__fixtures__/missing-backlog.md';
const DIRECTORY = 'tools/eslint/plugin/__fixtures__';
const REAL = 'docs/BACKLOG.md';
const WITH_FIXTURE = [{ backlogFile: FIXTURE }];
const WITH_MISSING = [{ backlogFile: MISSING }];

// expected location of a single-line report, 1-based columns as eslint reports them
const at = (line, column, length) => ({
  line,
  column,
  endLine: line,
  endColumn: column + length,
});
const MARKER_AT_START = at(1, 4, 'TODO'.length);

const missingId = (marker, loc) => ({ messageId: 'missingId', data: { marker }, ...loc });
const unknownId = (id, loc, backlogFile = FIXTURE) => ({
  messageId: 'unknownId',
  data: { id, backlogFile },
  ...loc,
});
const completedId = (id, loc, backlogFile = FIXTURE) => ({
  messageId: 'completedId',
  data: { id, backlogFile },
  ...loc,
});
const unreadable = (backlogFile, reason, loc) => ({
  messageId: 'backlogUnreadable',
  data: { backlogFile, reason },
  ...loc,
});

const ruleTester = new RuleTester();
const assertionOptions = { requireMessage: 'messageId', requireLocation: true, requireData: true };

describe('test environment', () => {
  it('runs from the repo root, which relative backlog paths resolve against', () => {
    assert.equal(path.relative(process.cwd(), ROOT), '');
  });

  it('registers the rule in the tsuzuki plugin', () => {
    assert.equal(tsuzukiPlugin.rules['backlog-reference'], backlogReference);
  });
});

ruleTester.run('backlog-reference (fixture backlog)', backlogReference, {
  assertionOptions,
  valid: [
    ...[
      '// TODO(F-05): theme tokens',
      '/* FIXME(C-02): x */',
      '// TODO(F-05): first, FIXME(C-02): second',
      '// @ts-expect-error(F-05): upstream type is wrong',
      '// @ts-ignore(C-02): x',
      '/// @ts-expect-error(F-05): x',
      '/* @ts-expect-error(F-05): x */',
      '/**\n * docs\n * @ts-expect-error(F-05): x */',
      // an id with one open line stays open
      '// TODO(L-01): x',
      // lowercase and longer words are not markers
      '// todo: lowercase is not a marker',
      '// Todo x',
      '// TODOS are counted elsewhere',
      '// FIXMEs pile up',
      // ts honours no directive in the middle of a comment or above the last line of a block
      '// see the @ts-ignore(F-99) directive',
      '/* @ts-ignore(F-99): x\n second line */',
      // the directive format without an id belongs to @typescript-eslint/ban-ts-comment
      '// @ts-expect-error: x',
      // code and strings are not comments
      "const TODO = 'TODO x';",
      '#!/usr/bin/env TODO\nexport const value = 1;',
    ].map((code) => ({ code, options: WITH_FIXTURE })),
    // a file that cites no id never reads the backlog
    { code: '// plain comment\n// @ts-expect-error: x\n', options: WITH_MISSING },
  ],
  invalid: [
    ...[
      '// TODO x',
      '// TODO: x',
      '// TODO(F-05)',
      '// TODO(F-05):',
      '// TODO(F-05): ',
      '// TODO(F-05):x',
      '// TODO(f-05): x',
      '// TODO (F-05): x',
      '// TODO(F-5): x',
      '// TODO(F-100): x',
      '// TODO[F-05]: x',
    ].map((code) => ({
      code,
      options: WITH_FIXTURE,
      errors: [missingId('TODO', MARKER_AT_START)],
    })),
    {
      code: '// FIXME x',
      options: WITH_FIXTURE,
      errors: [missingId('FIXME', at(1, 4, 'FIXME'.length))],
    },
    {
      code: 'const a = 1; // TODO x',
      options: WITH_FIXTURE,
      errors: [missingId('TODO', at(1, 17, 'TODO'.length))],
    },
    {
      code: '// TODO x and FIXME y',
      options: WITH_FIXTURE,
      errors: [missingId('TODO', MARKER_AT_START), missingId('FIXME', at(1, 15, 'FIXME'.length))],
    },
    {
      code: '// TODO(F-99): x',
      options: WITH_FIXTURE,
      errors: [unknownId('F-99', MARKER_AT_START)],
    },
    // "A-100" is no item, so "A-10" is not one either
    {
      code: '// TODO(A-10): x',
      options: WITH_FIXTURE,
      errors: [unknownId('A-10', MARKER_AT_START)],
    },
    // prose mentions and indented checkboxes are not items
    ...['R-01', 'R-02', 'R-03'].map((id) => ({
      code: `// TODO(${id}): x`,
      options: WITH_FIXTURE,
      errors: [unknownId(id, MARKER_AT_START)],
    })),
    {
      code: '// TODO(F-01): x',
      options: WITH_FIXTURE,
      errors: [completedId('F-01', MARKER_AT_START)],
    },
    {
      code: '/* FIXME(L-02): x */',
      options: WITH_FIXTURE,
      errors: [completedId('L-02', at(1, 4, 'FIXME'.length))],
    },
    // markdown renders "[X]" as a ticked box too
    {
      code: '// TODO(L-03): x',
      options: WITH_FIXTURE,
      errors: [completedId('L-03', MARKER_AT_START)],
    },
    {
      code: '// @ts-expect-error(L-03): x',
      options: WITH_FIXTURE,
      errors: [completedId('L-03', at(1, 4, '@ts-expect-error(L-03)'.length))],
    },
    {
      code: '// @ts-ignore(F-99): x',
      options: WITH_FIXTURE,
      errors: [unknownId('F-99', at(1, 4, '@ts-ignore(F-99)'.length))],
    },
    {
      code: '// @ts-expect-error(F-01): x',
      options: WITH_FIXTURE,
      errors: [completedId('F-01', at(1, 4, '@ts-expect-error(F-01)'.length))],
    },
    {
      code: '/// @ts-expect-error(F-01): x',
      options: WITH_FIXTURE,
      errors: [completedId('F-01', at(1, 5, '@ts-expect-error(F-01)'.length))],
    },
    {
      code: '/* @ts-ignore(F-99): x */',
      options: WITH_FIXTURE,
      errors: [unknownId('F-99', at(1, 4, '@ts-ignore(F-99)'.length))],
    },
    {
      code: '/*\n * notes\n * @ts-expect-error(F-01): x */',
      options: WITH_FIXTURE,
      errors: [completedId('F-01', at(3, 4, '@ts-expect-error(F-01)'.length))],
    },
    {
      code: '// @ts-expect-error(F-99): TODO(F-01): x',
      options: WITH_FIXTURE,
      errors: [
        unknownId('F-99', at(1, 4, '@ts-expect-error(F-99)'.length)),
        completedId('F-01', at(1, 28, 'TODO'.length)),
      ],
    },
    {
      code: '// TODO(F-01): x, FIXME(F-99): y, TODO z',
      options: WITH_FIXTURE,
      errors: [
        completedId('F-01', MARKER_AT_START),
        unknownId('F-99', at(1, 19, 'FIXME'.length)),
        missingId('TODO', at(1, 35, 'TODO'.length)),
      ],
    },
    {
      code: ['/*', ' * first line', ' * TODO(F-99): x', ' * FIXME', ' */'].join('\n'),
      options: WITH_FIXTURE,
      errors: [
        unknownId('F-99', at(3, 4, 'TODO'.length)),
        missingId('FIXME', at(4, 4, 'FIXME'.length)),
      ],
    },
    // an unreadable backlog is reported once per file, at the first cited id
    {
      code: '// TODO(F-05): x\n// FIXME(F-01): y\n// TODO z',
      options: WITH_MISSING,
      errors: [
        unreadable(MISSING, 'ENOENT', MARKER_AT_START),
        missingId('TODO', at(3, 4, 'TODO'.length)),
      ],
    },
    {
      code: '// plain\n// @ts-expect-error(F-05): x\n// TODO(F-99): y',
      options: WITH_MISSING,
      errors: [unreadable(MISSING, 'ENOENT', at(2, 4, '@ts-expect-error(F-05)'.length))],
    },
    {
      code: '// TODO(F-05): x',
      options: [{ backlogFile: DIRECTORY }],
      errors: [unreadable(DIRECTORY, 'EISDIR', MARKER_AT_START)],
    },
  ],
});

// "(type-test)" marks a permanent type-level assertion of a jest test file. it is no backlog id:
// this rule ignores it in every file and never reads the backlog for it. restricting it to jest
// test files, and its exact format, belong to @typescript-eslint/ban-ts-comment through
// eslint.config.mjs (tools/eslint/ts-directives.test.mjs)
const TYPE_TEST_FILES = ['src/ui/probe.test.tsx', 'src/core/probe.ts', 'tools/probe.test.mjs'];
ruleTester.run('backlog-reference ((type-test) directives)', backlogReference, {
  assertionOptions,
  valid: [
    '// @ts-expect-error(type-test): raw numbers are not tokens',
    '/// @ts-expect-error(type-test): x',
    '/* @ts-expect-error(type-test): x */',
    '/**\n * docs\n * @ts-expect-error(type-test): x */',
    // malformed variants and @ts-ignore are ban-ts-comment's to reject, not this rule's
    '// @ts-ignore(type-test): x',
    '// @ts-expect-error(type-test)',
    '// @ts-expect-error(type-test):x',
    '// @ts-expect-error(Type-Test): x',
    '// @ts-expect-error(type-tests): x',
  ].flatMap((code) =>
    TYPE_TEST_FILES.map((filename) => ({
      code,
      filename: path.join(ROOT, filename),
      // a missing backlog proves the rule never reads it for (type-test)
      options: WITH_MISSING,
    })),
  ),
  invalid: [
    // a work marker in the reason still cites a backlog id
    {
      code: '// @ts-expect-error(type-test): TODO x',
      filename: path.join(ROOT, 'src/ui/probe.test.tsx'),
      options: WITH_FIXTURE,
      errors: [missingId('TODO', at(1, 33, 'TODO'.length))],
    },
    {
      code: '// @ts-expect-error(type-test): FIXME(F-01): x',
      filename: path.join(ROOT, 'src/ui/probe.test.tsx'),
      options: WITH_FIXTURE,
      errors: [completedId('F-01', at(1, 33, 'FIXME'.length))],
    },
  ],
});

// integration with the real backlog: F-01 is ticked for good and Z-99 is no item, for good.
// R-06 is the last item to close: update when R-06 closes (cite any item still open)
ruleTester.run('backlog-reference (docs/BACKLOG.md, default option)', backlogReference, {
  assertionOptions,
  valid: [{ code: '// TODO(R-06): x' }, { code: '// FIXME(R-06): x', options: [{}] }],
  invalid: [
    {
      code: '// TODO(F-01): x',
      errors: [completedId('F-01', MARKER_AT_START, REAL)],
    },
    {
      code: '// TODO(Z-99): x',
      errors: [unknownId('Z-99', MARKER_AT_START, REAL)],
    },
  ],
});

describe('backlog-reference options schema', () => {
  const verify = (options) =>
    new Linter().verify('// TODO(F-05): x', [
      {
        plugins: { tsuzuki: tsuzukiPlugin },
        rules: { 'tsuzuki/backlog-reference': ['error', ...options] },
      },
    ]);

  it('rejects an empty backlog path', () => {
    assert.throws(() => verify([{ backlogFile: '' }]), /tsuzuki\/backlog-reference/);
  });

  it('rejects unknown properties', () => {
    assert.throws(() => verify([{ file: FIXTURE }]), /tsuzuki\/backlog-reference/);
  });

  it('accepts a backlog path', () => {
    assert.deepEqual(verify([{ backlogFile: FIXTURE }]), []);
  });
});

describe('backlog-reference messages', () => {
  it('suggests a placeholder id that is not a real backlog item', () => {
    const backlog = readFileSync(path.join(ROOT, REAL), 'utf8');
    const suggested = backlogReference.meta.messages.missingId.match(/\(([A-Z]-\d{2})\)/)?.[1];
    assert.equal(suggested, 'X-00');
    assert.equal(backlog.includes(suggested), false);
  });
});
