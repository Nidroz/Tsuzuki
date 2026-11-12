import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { CI_VARIABLES, METRO_URL, analyzeFlow, yamlFilesIn } from './maestro-flows.mjs';
import { readMaestroStepEnv, readMaestroTestLine } from './maestro-workflow.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'e2e.yml');
const CI_FLOWS = path.join(ROOT, 'e2e', 'flows');
const CI_TARGET = 'e2e/flows';
// no value on the command line: maestro reads the MAESTRO_ variables from its environment
const CI_COMMAND = 'maestro test e2e/flows || bash tools/ci/e2e-diagnostics.sh';
// the env of the step running the flows: the credentials from the secrets of the e2e environment,
// the run id from the run and its attempt
const CI_ENV = {
  MAESTRO_E2E_EMAIL: '${{ secrets.E2E_EMAIL }}',
  MAESTRO_E2E_PASSWORD: '${{ secrets.E2E_PASSWORD }}',
  MAESTRO_E2E_RUN_ID: '${{ github.run_id }}-${{ github.run_attempt }}',
};
const CREDENTIAL_SECRET = /\bsecrets\.E2E_(?:EMAIL|PASSWORD)\b/;
const PRESENCE_CHECK = /\$\{\{ secrets\.E2E_(?:EMAIL|PASSWORD) != '' \}\}$/;

const workflow = readFileSync(WORKFLOW, 'utf8');

describe('the e2e workflow', () => {
  it('runs the ci flows folder with no value on its command line', () => {
    const { command, names, targets } = readMaestroTestLine(workflow);
    assert.equal(command, CI_COMMAND);
    assert.deepEqual(names, []);
    assert.deepEqual(targets, [CI_TARGET]);
  });

  it('gives the ci variables to the maestro step, from the secrets and the run id', () => {
    assert.deepEqual(readMaestroStepEnv(workflow), CI_ENV);
    assert.deepEqual(Object.keys(CI_ENV).sort(), [...CI_VARIABLES].sort());
  });

  it('reads the credential secrets nowhere else, but to check they are set', () => {
    const stepLines = Object.entries(CI_ENV).map(([name, value]) => `${name}: ${value}`);
    const lines = workflow
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => CREDENTIAL_SECRET.test(line));
    for (const line of lines) {
      assert.ok(stepLines.includes(line) || PRESENCE_CHECK.test(line), line);
    }
    assert.equal(lines.filter((line) => stepLines.includes(line)).length, 2);
  });

  it('gives the ci flows every variable they read', () => {
    const external = [METRO_URL, ...Object.keys(readMaestroStepEnv(workflow))];
    for (const flow of yamlFilesIn(CI_FLOWS)) {
      assert.deepEqual(analyzeFlow(flow, { external }).problems, [], flow);
    }
  });

  it('prints the device state when the ci flows fail', () => {
    assert.match(workflow, /e2e\/flows \|\| bash tools\/ci\/e2e-diagnostics\.sh$/m);
    assert.ok(existsSync(path.join(ROOT, 'tools', 'ci', 'e2e-diagnostics.sh')));
  });
});

describe('the workflow readers', () => {
  const sample = [
    'env:',
    '  JOB: job',
    'jobs:',
    '  e2e:',
    '    steps:',
    '      - name: Run the flows',
    '        uses: some/action@sha',
    '        env:',
    '          # a comment',
    '          A: ${{ secrets.A }}',
    '',
    '          B: b',
    '        with:',
    '          script: |',
    '            env:',
    '            maestro test -e C="$C" e2e/flows || bash tools/ci/e2e-diagnostics.sh',
    '      # the next step',
    '      - name: Next',
    '        env:',
    '          D: d',
  ].join('\n');

  it('stops reading the maestro command at a || fallback', () => {
    const { names, targets } = readMaestroTestLine(sample);
    assert.deepEqual(names, ['C']);
    assert.deepEqual(targets, ['e2e/flows']);
  });

  it('read the env of the step holding the maestro line, and only it', () => {
    assert.deepEqual(readMaestroStepEnv(sample), { A: '${{ secrets.A }}', B: 'b' });
    const withoutEnv = sample.replace('        env:\n          # a comment', '        x:');
    assert.throws(() => readMaestroStepEnv(withoutEnv), /has no env/);
    assert.throws(() => readMaestroTestLine(`${sample}\nmaestro test e2e/flows`), /found 2/);
  });
});
