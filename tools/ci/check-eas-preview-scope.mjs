// cli entry of the staging build scope (eas-preview-scope.mjs), run by the EAS preview workflow:
// reads the changed file names (git diff --name-only) on stdin and appends build=true|false to
// $GITHUB_OUTPUT. FORCE_ALL=true (a manual run, or no usable previous commit) builds without
// reading stdin

import { appendFileSync, readFileSync } from 'node:fs';
import process from 'node:process';

import { classifyChanges, formatOutputs } from './eas-preview-scope.mjs';

const STDIN_FD = 0;
const FAILURE_EXIT_CODE = 1;
const FORCE_ALL = 'true';

const outputFile = process.env.GITHUB_OUTPUT;

if (outputFile === undefined || outputFile === '') {
  process.stderr.write('::error::GITHUB_OUTPUT is not set\n');
  process.exitCode = FAILURE_EXIT_CODE;
} else {
  const scope =
    process.env.FORCE_ALL === FORCE_ALL
      ? { build: true }
      : classifyChanges(readFileSync(STDIN_FD, 'utf8').split('\n'));
  const outputs = formatOutputs(scope);
  appendFileSync(outputFile, outputs);
  process.stdout.write(outputs);
}
