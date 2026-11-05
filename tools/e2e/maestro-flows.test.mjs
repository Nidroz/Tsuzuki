import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  APP_ID,
  CI_VARIABLES,
  DELETION_SELECTOR_PREFIXES,
  MANUAL_VARIABLES,
  METRO_URL,
  SHARED_ACCOUNT_VARIABLES,
  THROWAWAY_VARIABLES,
  analyzeFlow,
  readFlow,
  readMaestroTestLine,
  yamlFilesIn,
} from './maestro-flows.mjs';
import { collectTestIds } from './test-id-sources.mjs';
import { createIdMatcher, selectorMatches } from './test-ids.mjs';
import { YamlSubsetError, readYamlSubset } from './yaml-subset.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const E2E = path.join(ROOT, 'e2e');
const CI_FLOWS = path.join(E2E, 'flows');
const MANUAL_FLOWS = path.join(E2E, 'flows-manual');
const SUBFLOWS = path.join(E2E, 'subflows');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'e2e.yml');
const CI_TARGET = 'e2e/flows';
const SOURCE_FOLDERS = ['app', 'src'];
const SOURCE_FILE = /\.tsx?$/;
const EXCLUDED_SOURCE = /\.test\.tsx?$|\.d\.ts$/;
const EXCLUDED_FOLDERS = new Set(['__fixtures__']);

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

// the non-test typescript sources of a folder, recursively
const sourcesIn = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return EXCLUDED_FOLDERS.has(entry.name) ? [] : sourcesIn(file);
    }
    return SOURCE_FILE.test(entry.name) && !EXCLUDED_SOURCE.test(entry.name)
      ? [{ fileName: file, text: readFileSync(file, 'utf8') }]
      : [];
  });

const ciFlows = yamlFilesIn(CI_FLOWS);
const manualFlows = yamlFilesIn(MANUAL_FLOWS);
const allYaml = [...ciFlows, ...manualFlows, ...yamlFilesIn(SUBFLOWS)];
const ciExternal = [METRO_URL, ...CI_VARIABLES];
const manualExternal = [METRO_URL, ...MANUAL_VARIABLES];
const ciAnalyses = ciFlows.map((flow) => analyzeFlow(flow, { external: ciExternal }));
const manualAnalyses = manualFlows.map((flow) => analyzeFlow(flow, { external: manualExternal }));
const allAnalyses = [...ciAnalyses, ...manualAnalyses];

// inline flows for the unit cases: absolute paths under a fixed fake root
const FAKE_ROOT = path.resolve('/fixture');
const loaderOf = (files) => (file) =>
  files[path.relative(FAKE_ROOT, file).split(path.sep).join('/')] ?? null;
const HEADER = `appId: ${APP_ID}\n---\n`;

describe('the yaml subset reader', () => {
  it('reads mappings, sequences, quoted scalars and comments', () => {
    const text = [
      '# a header',
      'appId: app',
      'onFlowStart:',
      '  - setAirplaneMode: disabled',
      '---',
      '- back',
      '- tapOn:',
      '    id: x-.* # trailing comment',
      "- assertVisible: 'it''s # kept'",
      "- openLink: s://a?u=${f(B || 'c')}&d=1",
      '- runFlow:',
      '    commands:',
      '      - inputText: 42',
    ].join('\n');
    assert.deepEqual(readYamlSubset(text), [
      { appId: 'app', onFlowStart: [{ setAirplaneMode: 'disabled' }] },
      [
        'back',
        { tapOn: { id: 'x-.*' } },
        { assertVisible: "it's # kept" },
        { openLink: "s://a?u=${f(B || 'c')}&d=1" },
        { runFlow: { commands: [{ inputText: 42 }] } },
      ],
    ]);
  });

  it('rejects syntax outside the subset', () => {
    for (const text of ['- tapOn: { id: x }', 'a:\n\tb: 1', 'a: 1\na: 2', 'a: |\n  b']) {
      assert.throws(() => readYamlSubset(text), YamlSubsetError, text);
    }
  });
});

describe('the testID matcher', () => {
  const matcher = createIdMatcher(
    collectTestIds([
      {
        fileName: 'Account.tsx',
        text: [
          "const TEST_ID = 'settings-account';",
          'const UNSYNCED_TEST_ID = `${TEST_ID}-unsynced`;',
          "const label = 'settings';",
          'export function Account() {',
          '  return <X testID={`${TEST_ID}-sign-out`} confirmTestID={`${UNSYNCED_TEST_ID}-confirm`} />;',
          '}',
        ].join('\n'),
      },
      {
        fileName: 'Field.tsx',
        text: [
          'export function Field({ testID }) {',
          '  return <E testID={`${testID}-error`} />;',
          '}',
          'export function Screen() {',
          '  return <Field testID="auth-sign-in" />;',
          '}',
        ].join('\n'),
      },
      {
        fileName: 'Chips.tsx',
        text: [
          'export function Chips({ testID, options }) {',
          '  return options.map((option) => <C testID={`${testID}-${option.value}`} />);',
          '}',
          'export function Discover() {',
          '  return <Chips testID="discover-section" />;',
          '}',
        ].join('\n'),
      },
      {
        fileName: 'Row.tsx',
        text: [
          'export const rowTestID = (k) => `library-entry-${k.a}-${k.b}-${String(k.c)}`;',
          'function RowView({ entry }) {',
          '  const testID = rowTestID(entry.key);',
          '  return <H testID={`${testID}-favorite`} />;',
          '}',
          'export const Row = memo(RowView);',
        ].join('\n'),
      },
    ]),
  );

  it('accepts ids the source produces, resolving const strings of the same file', () => {
    for (const id of [
      'settings-account-sign-out',
      'settings-account-unsynced-confirm',
      'auth-sign-in-error',
      'discover-section-topManga',
    ]) {
      assert.ok(selectorMatches(matcher, id), id);
    }
  });

  it('rejects an id the source does not produce', () => {
    for (const id of ['settings-account-sign-outt', 'settings-account-delete', 'settings']) {
      assert.equal(selectorMatches(matcher, id), false, id);
    }
  });

  it('rejects a match through a leading wildcard whose prefix is unknown', () => {
    for (const id of [
      '.*-error',
      'unknown-screen-error',
      'auth-sign-in-x0',
      'settings-account-x0',
    ]) {
      assert.equal(selectorMatches(matcher, id), false, id);
    }
  });

  it('accepts a regex selector through its samples', () => {
    assert.ok(selectorMatches(matcher, 'library-entry-mal-anime-.*'));
    assert.ok(selectorMatches(matcher, 'library-entry-.*'));
    assert.ok(selectorMatches(matcher, 'library-entry-mal-anime-.*-favorite'));
    assert.ok(selectorMatches(matcher, 'library-entry-mal-anime-5114-favorite'));
    assert.throws(() => selectorMatches(matcher, 'library-(a|b)'), /unsupported regex/);
  });
});

describe('the variable check', () => {
  it('rejects an undefined variable and accepts one passed by env', () => {
    const load = loaderOf({
      'flows/a.yaml': `${HEADER}- runFlow:\n    file: ../sub/s.yaml\n    env:\n      EMAIL: \${E2E_EMAIL}\n- inputText: \${E2E_RUN_ID}\n`,
      'flows/b.yaml': `${HEADER}- runFlow:\n    file: ../sub/s.yaml\n`,
      'sub/s.yaml': `${HEADER}- inputText: \${EMAIL}\n`,
    });
    const external = [METRO_URL, ...CI_VARIABLES];
    const good = analyzeFlow(path.join(FAKE_ROOT, 'flows/a.yaml'), { external, load });
    assert.deepEqual(good.problems, []);
    const missing = analyzeFlow(path.join(FAKE_ROOT, 'flows/b.yaml'), { external, load });
    assert.equal(missing.problems.length, 1);
    assert.match(missing.problems[0], /\$\{EMAIL\} is not defined/);
    const manual = analyzeFlow(path.join(FAKE_ROOT, 'flows/a.yaml'), {
      external: [METRO_URL, ...MANUAL_VARIABLES],
      load,
    });
    assert.match(manual.problems.join('\n'), /\$\{E2E_EMAIL\} is not defined/);
  });

  it('rejects a missing subflow, a cycle and METRO_URL without a fallback', () => {
    const load = loaderOf({
      'a.yaml': `${HEADER}- runFlow:\n    file: b.yaml\n- runFlow: missing.yaml\n`,
      'b.yaml': `${HEADER}- runFlow: a.yaml\n- openLink: s://\${encodeURIComponent(METRO_URL)}\n`,
    });
    const { problems } = analyzeFlow(path.join(FAKE_ROOT, 'a.yaml'), {
      external: [METRO_URL],
      load,
    });
    const report = problems.join('\n');
    assert.match(report, /runFlow cycle/);
    assert.match(report, /runFlow file not found/);
    assert.match(report, /METRO_URL without a fallback/);
  });
});

describe('the e2e flows', () => {
  it('finds the ci and manual flows', () => {
    assert.ok(ciFlows.length > 0, 'no ci flow');
    assert.ok(manualFlows.length > 0, 'no manual flow');
  });

  it('read as the yaml subset and declare the development app id', () => {
    for (const file of allYaml) {
      const { config } = readFlow(readFileSync(file, 'utf8'));
      assert.equal(config.appId, APP_ID, relative(file));
    }
  });

  it('reach existing subflows, without a cycle, with every variable defined', () => {
    for (const { problems } of allAnalyses) {
      assert.deepEqual(problems, []);
    }
  });

  it('reach every subflow', () => {
    const reached = new Set(allAnalyses.flatMap(({ files }) => files));
    for (const file of yamlFilesIn(SUBFLOWS)) {
      assert.ok(reached.has(file), `${relative(file)} is reached by no flow`);
    }
  });

  it('select only ids the app source can produce', () => {
    const matcher = createIdMatcher(
      collectTestIds(SOURCE_FOLDERS.flatMap((folder) => sourcesIn(path.join(ROOT, folder)))),
    );
    const unknown = allAnalyses
      .flatMap(({ selectors }) => selectors)
      .filter(({ id }) => !selectorMatches(matcher, id))
      .map(({ file, id }) => `${relative(file)}: ${id}`);
    assert.deepEqual([...new Set(unknown)], []);
  });

  it('keep the ci flows away from the account deletion and the throwaway account', () => {
    for (const { files, selectors, variables } of ciAnalyses) {
      const flow = relative(files[0]);
      for (const { id } of selectors) {
        const deletion = DELETION_SELECTOR_PREFIXES.some((prefix) => id.startsWith(prefix));
        assert.equal(deletion, false, `${flow} reaches ${id}`);
      }
      for (const { name } of variables) {
        assert.equal(THROWAWAY_VARIABLES.includes(name), false, `${flow} reads ${name}`);
      }
    }
  });

  it('keep the manual flows away from the shared test account', () => {
    for (const { files, variables } of manualAnalyses) {
      for (const { name } of variables) {
        assert.equal(SHARED_ACCOUNT_VARIABLES.includes(name), false, `${relative(files[0])}`);
      }
    }
  });
});

describe('the e2e workflow', () => {
  it('passes exactly the ci variables and runs the ci flows folder only', () => {
    const { names, targets } = readMaestroTestLine(readFileSync(WORKFLOW, 'utf8'));
    assert.deepEqual([...names].sort(), [...CI_VARIABLES].sort());
    assert.deepEqual(targets, [CI_TARGET]);
  });

  it('stops reading the maestro command at a || fallback', () => {
    const { names, targets } = readMaestroTestLine(
      '    maestro test -e A="$A" e2e/flows || bash tools/ci/e2e-diagnostics.sh\n',
    );
    assert.deepEqual(names, ['A']);
    assert.deepEqual(targets, ['e2e/flows']);
  });

  it('prints the device state when the ci flows fail', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    assert.match(workflow, /e2e\/flows \|\| bash tools\/ci\/e2e-diagnostics\.sh$/m);
    assert.ok(existsSync(path.join(ROOT, 'tools', 'ci', 'e2e-diagnostics.sh')));
  });
});
