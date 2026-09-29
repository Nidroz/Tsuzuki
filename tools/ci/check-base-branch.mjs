// cli entry of the base branch policy (base-branch.mjs), run by the PR policy workflow with the pull
// request metadata passed through the environment

import process from 'node:process';

import { baseBranchViolation } from './base-branch.mjs';

const ENV_NAMES = {
  baseRef: 'BASE_REF',
  headRef: 'HEAD_REF',
  headRepo: 'HEAD_REPO',
  repository: 'REPOSITORY',
};
const FAILURE_EXIT_CODE = 1;

// workflow command data escaping: a branch name can never end the annotation or start a new command
const escapeCommandData = (text) =>
  text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

const pullRequest = Object.fromEntries(
  Object.entries(ENV_NAMES).map(([key, name]) => [key, process.env[name]]),
);
const violation = baseBranchViolation(pullRequest);

if (violation === null) {
  const { headRepo, headRef, baseRef } = pullRequest;
  process.stdout.write(`base branch policy OK: ${headRepo}:${headRef} -> ${baseRef}\n`);
} else {
  process.stderr.write(`::error::${escapeCommandData(violation)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
}
