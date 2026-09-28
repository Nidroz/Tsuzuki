// regression tests for the test hygiene rules of eslint.config.mjs on the node:test tooling suites
// (tools/**/*.test.mjs): tests are never skipped, focused or left todo (CONTRIBUTING.md section 6).
// probes are virtual files (lintText), never written to disk

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ESLint } from 'eslint';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HYGIENE_RULE_IDS = ['no-restricted-syntax', 'no-restricted-properties'];
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

const lint = async (file, code) => {
  const [result] = await eslint.lintText(HEADER + code, { filePath: path.join(ROOT, file) });
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
  ['destructured skip', "const { skip } = it;\nskip('x', () => {});"],
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
  for (const [name, code] of ALLOWED) {
    it(name, async () => {
      assertAllowed(await lint(TEST_PROBES[0], code));
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
