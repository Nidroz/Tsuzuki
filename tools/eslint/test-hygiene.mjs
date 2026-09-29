// test hygiene tables for eslint.config.mjs on the node:test tooling suites (the test:tooling
// script): tests are never skipped, focused or left todo (CONTRIBUTING.md section 6); jest tests get
// jest/no-disabled-tests and jest/no-focused-tests instead

import { memberName, oneOf, propertyKey } from './selectors.mjs';

export const TOOLING_TEST_FILES = ['tools/**/*.test.mjs'];

const TEST_HYGIENE_MESSAGE =
  'tests are never skipped, focused or left todo (CONTRIBUTING.md section 6).';
const TEST_RUNNERS = ['it', 'test', 'describe', 'suite'];
// runner methods and option keys alike; only also focuses a RuleTester case
const TEST_MODIFIERS = ['skip', 'only', 'todo'];
const FOCUS_KEY = 'only';
// test context methods that skip, todo or focus from inside a test body (t.skip(), t.runOnly(true))
const TEST_CONTEXT_MODIFIERS = ['skip', 'todo', 'runOnly'];
// node:test exports that may be imported, each under its own name only: an alias, a namespace or
// the default export (the runner itself) would escape the runner names above
const NODE_TEST_SOURCE = 'node:test';
const NODE_TEST_IMPORTS = [
  'after',
  'afterEach',
  'assert',
  'before',
  'beforeEach',
  'describe',
  'it',
  'mock',
  'run',
  'snapshot',
  'suite',
  'test',
];

// object/property pairs also catch computed (it['skip']) and destructured ({ skip } = it) forms
export const TEST_HYGIENE_PROPERTIES = [
  ...TEST_RUNNERS.flatMap((object) =>
    TEST_MODIFIERS.map((property) => ({
      object,
      property,
      message: `${object}.${property}: ${TEST_HYGIENE_MESSAGE}`,
    })),
  ),
  {
    object: 'RuleTester',
    property: FOCUS_KEY,
    message: `RuleTester.only: ${TEST_HYGIENE_MESSAGE}`,
  },
];

const NODE_TEST_IMPORT = `ImportDeclaration[source.value='${NODE_TEST_SOURCE}']`;
// esquery cannot compare two fields: one [imported][local] pair per allowed name
const PLAIN_NODE_TEST_SPECIFIER = NODE_TEST_IMPORTS.map(
  (name) => `[imported.name='${name}'][local.name='${name}']`,
).join(', ');

export const TEST_HYGIENE_SYNTAX = [
  // in any object literal, whatever its value: runner options and RuleTester cases, however they
  // are built (inline or through a variable); { skip: false } is one edit away from skipping
  {
    selector: `ObjectExpression > ${propertyKey(oneOf(TEST_MODIFIERS))}`,
    message: `skip, only and todo options: ${TEST_HYGIENE_MESSAGE}`,
  },
  // .only focuses on any object, called or not: a renamed runner (suite2.only), a subtest runner
  // (t.test.only) or a helper; skip and todo stay plain data on other objects (options.skip)
  {
    selector: `MemberExpression${memberName(oneOf([FOCUS_KEY]))}`,
    message: `.only on any object: ${TEST_HYGIENE_MESSAGE}`,
  },
  // whatever the test context is called; optional calls (t.skip?.()) are call expressions too
  {
    selector: `CallExpression[callee.type='MemberExpression']${memberName(oneOf(TEST_CONTEXT_MODIFIERS), 'callee.')}`,
    message: `skip, todo and runOnly calls: ${TEST_HYGIENE_MESSAGE}`,
  },
  {
    selector: `${NODE_TEST_IMPORT} > :matches(ImportDefaultSpecifier, ImportNamespaceSpecifier)`,
    message: `${NODE_TEST_SOURCE} default and namespace imports: ${TEST_HYGIENE_MESSAGE}`,
  },
  {
    selector: `${NODE_TEST_IMPORT} > ImportSpecifier:not(${PLAIN_NODE_TEST_SPECIFIER})`,
    message: `${NODE_TEST_SOURCE} imports are unrenamed (${NODE_TEST_IMPORTS.join(', ')}): ${TEST_HYGIENE_MESSAGE}`,
  },
];
