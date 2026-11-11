import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

// the success paths of the cli (check-eas-preview-scope.mjs): its failure without GITHUB_OUTPUT is
// in eas-preview-scope.test.mjs

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const CLI = path.join(import.meta.dirname, 'check-eas-preview-scope.mjs');
// inside the repository, git-ignored: no file outside it
const CACHE = path.join(ROOT, 'node_modules', '.cache');
// a line an earlier step of the job wrote: appended to, never replaced
const EARLIER_OUTPUT = 'migrations=false\n';
const APP_CHANGE = 'docs/BACKLOG.md\nsrc/core/domain/progress.ts\n';
const DOCS_CHANGE = 'docs/BACKLOG.md\nREADME.md\n';

let directory = '';
let runs = 0;

before(() => {
  mkdirSync(CACHE, { recursive: true });
  directory = mkdtempSync(path.join(CACHE, 'check-eas-preview-scope-'));
});

after(() => {
  rmSync(directory, { recursive: true, force: true });
});

// runs the cli with `input` on stdin (null: stdin ignored), FORCE_ALL `force`, and a fresh
// GITHUB_OUTPUT file holding an earlier line; returns the process result and that file's content
const runCli = (input, force) => {
  runs += 1;
  const outputFile = path.join(directory, `output-${String(runs)}`);
  writeFileSync(outputFile, EARLIER_OUTPUT);
  const result = spawnSync(process.execPath, [CLI], {
    cwd: ROOT,
    encoding: 'utf8',
    ...(input === null ? { stdio: ['ignore', 'pipe', 'pipe'] } : { input }),
    env: { ...process.env, GITHUB_OUTPUT: outputFile, FORCE_ALL: force },
  });
  return { result, output: readFileSync(outputFile, 'utf8') };
};

const assertBuild = ({ result, output }, build) => {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, `build=${String(build)}\n`);
  assert.equal(output, `${EARLIER_OUTPUT}build=${String(build)}\n`);
};

describe('check-eas-preview-scope cli', () => {
  it('builds for a change to the app read on stdin', () => {
    assertBuild(runCli(APP_CHANGE, ''), true);
  });

  it('does not build for a docs-only change, FORCE_ALL being anything but true', () => {
    assertBuild(runCli(DOCS_CHANGE, ''), false);
    assertBuild(runCli(DOCS_CHANGE, 'false'), false);
  });

  it('builds with FORCE_ALL=true whatever stdin holds', () => {
    assertBuild(runCli(DOCS_CHANGE, 'true'), true);
  });

  it('builds with FORCE_ALL=true without reading stdin', () => {
    assertBuild(runCli(null, 'true'), true);
  });
});
