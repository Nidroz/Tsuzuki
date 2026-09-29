// regression tests for the test hygiene rules of eslint.config.mjs on the node:test tooling suites
// (tools/**/*.test.mjs): tests are never skipped, focused or left todo (CONTRIBUTING.md section 6).
// probes are virtual files (lintText), never written to disk

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ESLint } from 'eslint';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
// an import ban may live in either import rule; the message fragment still has to match
const HYGIENE_RULE_IDS = [
  'no-restricted-syntax',
  'no-restricted-properties',
  'no-restricted-imports',
  '@typescript-eslint/no-restricted-imports',
];
const FRAGMENT = 'tests are never skipped, focused or left todo';
const JIKAN_FRAGMENT = 'src/core/catalog/jikan';

// .mjs files are not type-checked: a virtual path needs no project
const TEST_PROBES = [
  'tools/probe.test.mjs',
  'tools/eslint/probe.test.mjs',
  'tools/commitlint/probe.test.mjs',
];
const NON_TEST_PROBE = 'tools/probe.mjs';

const HEADER = "import { describe, it, suite, test } from 'node:test';\n\n";
const RUNNERS = ['it', 'test', 'describe', 'suite'];
const MODIFIERS = ['skip', 'only', 'todo'];

const eslint = new ESLint({ cwd: ROOT });

const describeMessages = (messages) =>
  messages.map(({ ruleId, message }) => `  ${ruleId ?? '(no rule)'}: ${message}`).join('\n') ||
  '  (no message)';

// header: false for probes that write their own node:test import (a second binding would not parse)
const lint = async (file, code, { header = true } = {}) => {
  const text = header ? HEADER + code : code;
  const [result] = await eslint.lintText(text, { filePath: path.join(ROOT, file) });
  assert.ok(result, `no lint result for ${file}`);
  // a parse error or an ignored file would make every positive control pass vacuously
  const fatal = result.messages.filter(({ fatal: isFatal, ruleId }) => isFatal || ruleId === null);
  assert.deepEqual(fatal, [], `${file} must be parsed and linted:\n${describeMessages(fatal)}`);
  return result.messages;
};

const hygieneReports = (messages) =>
  messages.filter(
    ({ ruleId, message }) => HYGIENE_RULE_IDS.includes(ruleId) && message.includes(FRAGMENT),
  );

const assertBanned = (messages) => {
  assert.ok(
    hygieneReports(messages).length > 0,
    `expected ${HYGIENE_RULE_IDS.join(' or ')} containing "${FRAGMENT}", got:\n${describeMessages(messages)}`,
  );
};

const assertAllowed = (messages) => {
  const reports = messages.filter(({ ruleId }) => HYGIENE_RULE_IDS.includes(ruleId));
  assert.deepEqual(
    reports,
    [],
    `expected no restricted report, got:\n${describeMessages(reports)}`,
  );
};

const BANNED = [
  // modifiers, called or merely referenced (an alias would run the same way)
  ...RUNNERS.flatMap((runner) =>
    MODIFIERS.flatMap((modifier) => [
      [`${runner}.${modifier} call`, `${runner}.${modifier}('x', () => {});`],
      [
        `${runner}.${modifier} reference`,
        `const run = ${runner}.${modifier};\nrun('x', () => {});`,
      ],
    ]),
  ),
  ["computed it['skip']", "it['skip']('x', () => {});"],
  ["computed describe['only']", "describe['only']('x', () => {});"],
  ['computed it[`only`] (template key)', "it[`only`]('x', () => {});"],
  ['computed test[`skip`] (template key)', "test[`skip`]('x', () => {});"],
  ['destructured skip', "const { skip } = it;\nskip('x', () => {});"],
  ['destructured only', "const { only } = describe;\nonly('x', () => {});"],
  ["stored test['only']", "const focus = test['only'];\nfocus('x', () => {});"],
  // .only focuses on any object: a renamed runner, a subtest runner or a helper
  ['.only on a renamed runner', "const suite2 = suite;\nsuite2.only('x', () => {});"],
  ['.only on any object', "export const focus = (foo) => foo.only('x', () => {});"],
  [
    '.only stored from any object',
    'export const focus = (foo) => {\n  const run = foo.only;\n  return run;\n};',
  ],
  ['computed .only on any object', "export const focus = (foo) => foo['only']('x', () => {});"],
  ['t.test.only() in a test body', "it('x', (t) => {\n  t.test.only('y', () => {});\n});"],
  // options objects
  ...RUNNERS.flatMap((runner) =>
    MODIFIERS.map((key) => [
      `${runner} with { ${key}: true }`,
      `${runner}('x', { ${key}: true }, () => {});`,
    ]),
  ),
  ["it with { skip: 'reason' }", "it('x', { skip: 'not ready' }, () => {});"],
  ["test with { todo: 'reason' }", "test('x', { todo: 'later' }, () => {});"],
  ['it with { skip: false }', "it('x', { skip: false }, () => {});"],
  ['it with { timeout, only }', "it('x', { timeout: 10, only: true }, () => {});"],
  ['shorthand { only }', "const only = true;\nit('x', { only }, () => {});"],
  // computed keys: a string ({ ['only']: true }) or an expression-free template ({ [`only`]: true })
  ["it with { ['only']: true }", "it('x', { ['only']: true }, () => {});"],
  ["describe with { ['skip']: true }", "describe('x', { ['skip']: true }, () => {});"],
  ["test with { ['todo']: 'reason' }", "test('x', { ['todo']: 'later' }, () => {});"],
  ['it with { [`only`]: true }', "it('x', { [`only`]: true }, () => {});"],
  ['describe with { [`skip`]: true }', "describe('x', { [`skip`]: true }, () => {});"],
  ["test with { [`todo`]: 'reason' }", "test('x', { [`todo`]: 'later' }, () => {});"],
  ['{ [`skip`]: true } through a variable', "const o = { [`skip`]: true };\nit('x', o, () => {});"],
  // options built outside the runner call
  ['{ skip: true } through a variable', "const o = { skip: true };\nit('x', o, () => {});"],
  [
    "{ todo: 'reason' } through a variable",
    "const o = { todo: 'later' };\ntest('x', o, () => {});",
  ],
  ['{ only: true } through a variable', "const o = { only: true };\ndescribe('x', o, () => {});"],
  // test context methods, whatever the context is called
  ["t.skip('reason') in a test body", "it('x', (t) => {\n  t.skip('later');\n});"],
  ['t.skip?.() in a test body', "it('x', (t) => {\n  t.skip?.();\n});"],
  ['context.todo() in a test body', "test('x', (context) => {\n  context.todo();\n});"],
  ['t.runOnly(true) in a suite', "describe('x', (t) => {\n  t.runOnly(true);\n});"],
  ['t.test.skip() in a test body', "it('x', (t) => {\n  t.test.skip('y', () => {});\n});"],
  // computed forms of the test context methods
  ["t['skip']() in a test body", "it('x', (t) => {\n  t['skip']();\n});"],
  ["t['todo']() in a test body", "it('x', (t) => {\n  t['todo']();\n});"],
  ["t['runOnly'](true) in a suite", "describe('x', (t) => {\n  t['runOnly'](true);\n});"],
  ['t[`skip`]() in a test body', "it('x', (t) => {\n  t[`skip`]();\n});"],
  // node:test imported under another name escapes the runner names above
  ['renamed import of it', "import { it as check } from 'node:test';\n\ncheck('x', () => {});"],
  [
    'renamed import of describe',
    "import { describe as group } from 'node:test';\n\ngroup('x', () => {});",
  ],
  ['namespace import', "import * as nt from 'node:test';\n\nnt.it('x', () => {});"],
  // the default export is the runner itself: run.skip and run.only escape the runner names
  ['default import with a modifier', "import run from 'node:test';\n\nrun.skip('x', () => {});"],
  ['default import called', "import run from 'node:test';\n\nrun('x', () => {});"],
  // focused RuleTester cases
  [
    'RuleTester valid case with only: true',
    "export const cases = { valid: [{ code: 'x', only: true }], invalid: [] };",
  ],
  [
    'RuleTester invalid case with only: true',
    "export const cases = { valid: [], invalid: [{ code: 'x', errors: 1, only: true }] };",
  ],
  [
    'RuleTester.only',
    "import { RuleTester } from 'eslint';\n\nexport const cases = { valid: [RuleTester.only('x')] };",
  ],
];

const ALLOWED = [
  ['it', "it('x', () => {});"],
  ['test', "test('x', () => {});"],
  ['describe', "describe('x', () => {\n  it('y', () => {});\n});"],
  ['suite', "suite('x', () => {});"],
  ['it with { timeout }', "it('x', { timeout: 10 }, () => {});"],
  ['describe with { concurrency }', "describe('x', { concurrency: 1 }, () => {});"],
  [
    'RuleTester cases',
    "export const cases = {\n  valid: [{ code: 'x' }, 'y'],\n  invalid: [{ code: 'z', errors: [{ messageId: 'm' }] }],\n};",
  ],
  ['words in strings', "it('header-only message, skip nothing, todo list', () => {});"],
  ['regex', 'export const pattern = /only supports the "always" condition/;'],
  ['unrelated object', 'export const options = { onlyFiles: true, skipped: 0 };'],
  [
    'unrelated shorthand object',
    'const onlyFiles = true;\nconst skipped = 0;\nexport const options = { onlyFiles, skipped };',
  ],
  ['unrelated options variable', "const o = { timeout: 10 };\nit('x', o, () => {});"],
  ['test context methods', "it('x', (t) => {\n  t.plan(1);\n  t.diagnostic('y');\n});"],
  ['member call not named skip', 'export const rest = (list) => list.skipWhile?.((item) => item);'],
  ["'skip' as an argument", "export const hasSkip = (array) => array.includes('skip');"],
  // skip and todo are banned on runners and as calls, not as plain data on other objects
  ['options.skip read', 'export const isSkipped = (options) => options.skip === true;'],
  ['list.todo read', 'export const pending = (list) => list.todo;'],
  ["options['skip'] read", "export const isSkipped = (options) => options['skip'] === true;"],
  ['skip destructured from options', 'export const isSkipped = ({ skip: value }) => value;'],
  [
    "['skip'] destructured from options",
    "export const isSkipped = ({ ['skip']: value }) => value;",
  ],
  [
    '[`skip`] destructured from options',
    'export const isSkipped = ({ [`skip`]: value }) => value;',
  ],
  ['only as a plain word in a member name', 'export const pick = (list) => list.onlyFirst;'],
  [
    'named node:test imports',
    "import { describe, it } from 'node:test';\n\ndescribe('x', () => {\n  it('y', () => {});\n});",
    { header: false },
  ],
  [
    'named node:test hook and mock imports',
    "import { beforeEach, mock } from 'node:test';\n\nbeforeEach(() => {\n  mock.reset();\n});",
    { header: false },
  ],
  ['node:assert import', "import assert from 'node:assert/strict';\n\nassert.ok(true);"],
  [
    'RuleTester import',
    "import { RuleTester } from 'eslint';\n\nexport const tester = new RuleTester();",
  ],
];

describe('test hygiene: banned in tooling tests', () => {
  for (const file of TEST_PROBES) {
    describe(file, () => {
      for (const [name, code] of BANNED) {
        it(name, async () => {
          assertBanned(await lint(file, code));
        });
      }
    });
  }
});

describe('test hygiene: allowed in tooling tests (positive controls)', () => {
  for (const [name, code, options] of ALLOWED) {
    it(name, async () => {
      assertAllowed(await lint(TEST_PROBES[0], code, options));
    });
  }
});

describe(`test hygiene: ${NON_TEST_PROBE} is not a test file`, () => {
  for (const [name, code] of BANNED) {
    it(name, async () => {
      const messages = await lint(NON_TEST_PROBE, code);
      assert.deepEqual(hygieneReports(messages), [], describeMessages(messages));
    });
  }
});

describe('test hygiene: base guards', () => {
  // flat config replaces rule options: the tooling tests keep the base no-restricted-syntax guards
  it('keeps the catalog provider guard in tooling tests', async () => {
    // assembled so this file does not trip the guard itself
    const host = ['api.jikan', 'moe'].join('.');
    const messages = await lint(TEST_PROBES[0], `export const url = 'https://${host}/v4';`);
    assert.ok(
      messages.some(
        ({ ruleId, message }) =>
          ruleId === 'no-restricted-syntax' && message.includes(JIKAN_FRAGMENT),
      ),
      describeMessages(messages),
    );
  });
});
