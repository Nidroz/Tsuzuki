// regression tests for the ts directive rules of eslint.config.mjs (CONTRIBUTING.md section 5),
// linted through the real config. a directive cites an open backlog id: "@ts-expect-error(F-05): x".
// the one exception is the permanent type-level assertion of a jest test file (*.test.ts,
// *.test.tsx): "@ts-expect-error(type-test): reason". @typescript-eslint/ban-ts-comment owns the
// directive format and restricts (type-test) to jest test files through the config;
// tsuzuki/backlog-reference only checks that a cited backlog id is open, and (type-test) is no id.
// probes are virtual files (lintText), never written to disk

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { ESLint } from 'eslint';

import { ROOT, literalGlob } from './layers-harness.mjs';

const BAN = '@typescript-eslint/ban-ts-comment';
const BACKLOG = 'tsuzuki/backlog-reference';
const DIRECTIVE_RULE_IDS = [BAN, BACKLOG];

// the real backlog: F-01 is ticked for good. R-06 is the last item to close: update when it closes
// (cite any item still open)
const OPEN_ID = 'R-06';
const TICKED_ID = 'F-01';

// jest test files, where (type-test) is accepted
const JEST_TEST_PROBES = [
  'src/ui/probe.test.tsx',
  'src/features/probe.test.ts',
  'src/core/probe.test.ts',
  'test/mobile/probe.test.tsx',
];
// everything else keeps the backlog id rule: sources, test utilities and node:test tooling suites
const NON_TEST_PROBES = ['src/ui/probe.tsx', 'src/core/probe.ts', 'test/mobile/probe.ts'];
const TOOLING_TEST_PROBE = 'tools/probe.test.mjs';

const TS_PROBES = [...JEST_TEST_PROBES, ...NON_TEST_PROBES];

// the probes are type-checked like real files: the project service only has to accept the virtual
// paths. .mjs files stay untyped, as in the real config
const eslint = new ESLint({
  cwd: ROOT,
  overrideConfig: [
    {
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        parserOptions: {
          projectService: {
            allowDefaultProject: TS_PROBES.map(literalGlob),
            defaultProject: 'tsconfig.json',
            maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: TS_PROBES.length,
          },
        },
      },
    },
  ],
});

// a real type error under the directive, as in a type-level assertion
const TYPE_ERROR = 'export const value: string = 1;\n';
const JS_LINE = 'export const value = 1;\n';
const probeCode = (file, comment) => `${comment}\n${file.endsWith('.mjs') ? JS_LINE : TYPE_ERROR}`;

const describeMessages = (messages) =>
  messages.map(({ ruleId, message }) => `  ${ruleId ?? '(no rule)'}: ${message}`).join('\n') ||
  '  (no message)';

const lint = async (file, comment) => {
  const [result] = await eslint.lintText(probeCode(file, comment), {
    filePath: path.join(ROOT, file),
  });
  assert.ok(result, `no lint result for ${file}`);
  // a parse error or an ignored file would make every negative control pass vacuously
  const fatal = result.messages.filter(({ fatal: isFatal, ruleId }) => isFatal || ruleId === null);
  assert.deepEqual(fatal, [], `${file} must be parsed and linted:\n${describeMessages(fatal)}`);
  return result.messages;
};

const reportsOf = (messages, ruleIds) => messages.filter(({ ruleId }) => ruleIds.includes(ruleId));

const assertAccepted = (messages) => {
  const reports = reportsOf(messages, DIRECTIVE_RULE_IDS);
  assert.deepEqual(
    reports,
    [],
    `expected no ${DIRECTIVE_RULE_IDS.join(' or ')} report, got:\n${describeMessages(reports)}`,
  );
};

const assertReportedBy = (messages, ruleId) => {
  assert.ok(
    reportsOf(messages, [ruleId]).length > 0,
    `expected a ${ruleId} report, got:\n${describeMessages(messages)}`,
  );
};

const assertNotReportedBy = (messages, ruleId) => {
  const reports = reportsOf(messages, [ruleId]);
  assert.deepEqual(reports, [], `expected no ${ruleId} report, got:\n${describeMessages(reports)}`);
};

const TYPE_TEST_FORMS = [
  ['line', '// @ts-expect-error(type-test): raw numbers are not tokens'],
  ['triple slash', '/// @ts-expect-error(type-test): raw numbers are not tokens'],
  ['block', '/* @ts-expect-error(type-test): raw numbers are not tokens */'],
  [
    'last line of a block',
    '/*\n * notes\n * @ts-expect-error(type-test): raw numbers are not tokens */',
  ],
];

describe('ts directives: (type-test) accepted in jest test files', () => {
  for (const file of JEST_TEST_PROBES) {
    for (const [form, comment] of TYPE_TEST_FORMS) {
      it(`${form} form in ${file}`, async () => {
        assertAccepted(await lint(file, comment));
      });
    }
  }
});

describe('ts directives: (type-test) rejected outside jest test files', () => {
  for (const file of [...NON_TEST_PROBES, TOOLING_TEST_PROBE]) {
    for (const [form, comment] of TYPE_TEST_FORMS) {
      it(`${form} form in ${file}`, async () => {
        const messages = await lint(file, comment);
        assertReportedBy(messages, BAN);
        // (type-test) is no backlog id: the format rule alone reports it
        assertNotReportedBy(messages, BACKLOG);
      });
    }
  }
});

describe('ts directives: @ts-ignore(type-test) rejected everywhere', () => {
  for (const file of [...JEST_TEST_PROBES, ...NON_TEST_PROBES]) {
    for (const comment of [
      '// @ts-ignore(type-test): raw numbers are not tokens',
      '/* @ts-ignore(type-test): raw numbers are not tokens */',
    ]) {
      it(`${comment} in ${file}`, async () => {
        assertReportedBy(await lint(file, comment), BAN);
      });
    }
  }
});

const MALFORMED_TYPE_TESTS = [
  ['no reason', '// @ts-expect-error(type-test)'],
  ['no reason after the colon', '// @ts-expect-error(type-test):'],
  ['blank reason', '// @ts-expect-error(type-test):   '],
  ['no space after the colon', '// @ts-expect-error(type-test):reason'],
  ['no colon', '// @ts-expect-error(type-test) reason'],
  ['space before the parenthesis', '// @ts-expect-error (type-test): reason'],
  ['capitalised marker', '// @ts-expect-error(Type-Test): reason'],
  ['uppercase marker', '// @ts-expect-error(TYPE-TEST): reason'],
  ['plural marker', '// @ts-expect-error(type-tests): reason'],
  ['marker without the dash', '// @ts-expect-error(typetest): reason'],
  ['marker without parentheses', '// @ts-expect-error type-test: reason'],
  ['block without a reason', '/* @ts-expect-error(type-test) */'],
  ['block without a space after the colon', '/* @ts-expect-error(type-test):reason */'],
];

describe('ts directives: malformed (type-test) rejected in jest test files', () => {
  for (const file of ['src/ui/probe.test.tsx', 'src/features/probe.test.ts']) {
    for (const [name, comment] of MALFORMED_TYPE_TESTS) {
      it(`${name} in ${file}`, async () => {
        assertReportedBy(await lint(file, comment), BAN);
      });
    }
  }
});

describe('ts directives: work markers inside a (type-test) reason', () => {
  it('a TODO in the reason still cites a backlog id', async () => {
    const messages = await lint(
      'src/ui/probe.test.tsx',
      '// @ts-expect-error(type-test): TODO tighten the token type',
    );
    assertReportedBy(messages, BACKLOG);
  });
});

describe('ts directives: backlog ids keep working', () => {
  for (const file of [...JEST_TEST_PROBES, ...NON_TEST_PROBES]) {
    it(`an open id is accepted in ${file}`, async () => {
      assertAccepted(await lint(file, `// @ts-expect-error(${OPEN_ID}): upstream type is wrong`));
    });

    it(`an open id in a block is accepted in ${file}`, async () => {
      assertAccepted(
        await lint(file, `/* @ts-expect-error(${OPEN_ID}): upstream type is wrong */`),
      );
    });

    it(`a ticked id is rejected by ${BACKLOG} in ${file}`, async () => {
      const messages = await lint(
        file,
        `// @ts-expect-error(${TICKED_ID}): upstream type is wrong`,
      );
      assertReportedBy(messages, BACKLOG);
      // the format is right: only the id is stale
      assertNotReportedBy(messages, BAN);
    });

    it(`a malformed id is rejected in ${file}`, async () => {
      assertReportedBy(await lint(file, '// @ts-expect-error(F-5): upstream type is wrong'), BAN);
    });

    it(`an id without a description is rejected in ${file}`, async () => {
      assertReportedBy(await lint(file, `// @ts-expect-error(${OPEN_ID})`), BAN);
    });

    it(`a bare directive is rejected in ${file}`, async () => {
      assertReportedBy(await lint(file, '// @ts-expect-error: upstream type is wrong'), BAN);
    });
  }

  it('@ts-ignore with an open id keeps its format rule in a jest test file', async () => {
    assertAccepted(await lint('src/ui/probe.test.tsx', `// @ts-ignore(${OPEN_ID}): upstream type`));
  });

  it('@ts-nocheck stays banned in a jest test file', async () => {
    assertReportedBy(await lint('src/ui/probe.test.tsx', '// @ts-nocheck'), BAN);
  });
});
