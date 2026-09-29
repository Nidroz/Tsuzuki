import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MAIN_HEADS, PROTECTED_BASE, baseBranchViolation } from './base-branch.mjs';

const CLI = path.join(import.meta.dirname, 'check-base-branch.mjs');
const REPOSITORY = 'owner/tsuzuki';
const FORK = 'someone/tsuzuki';
const POLICY_SUFFIX = '(see CONTRIBUTING.md section 2)';
const MISSING_PREFIX = 'missing pull request metadata:';
const INPUT_KEYS = ['baseRef', 'headRef', 'headRepo', 'repository'];
const RELEASE_PLEASE_HEAD = 'release-please--branches--main';
const RELEASE_PLEASE_COMPONENT_PREFIX = `${RELEASE_PLEASE_HEAD}--components--`;
const ERROR_PREFIX = '::error::';
const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;

const pullRequest = (overrides = {}) => ({
  baseRef: PROTECTED_BASE,
  headRef: MAIN_HEADS.release,
  headRepo: REPOSITORY,
  repository: REPOSITORY,
  ...overrides,
});

const missingMessage = (keys) => `${MISSING_PREFIX} ${keys.join(', ')} ${POLICY_SUFFIX}`;

describe('base branch policy constants', () => {
  it('protects main and lists the heads allowed to target it', () => {
    assert.equal(PROTECTED_BASE, 'main');
    assert.deepEqual(MAIN_HEADS, {
      release: 'dev',
      hotfixPrefix: 'hotfix/',
      releasePlease: RELEASE_PLEASE_HEAD,
      releasePleaseComponentPrefix: RELEASE_PLEASE_COMPONENT_PREFIX,
    });
  });
});

describe('baseBranchViolation', () => {
  describe('heads allowed to target main from the same repository', () => {
    const heads = [
      'dev',
      'hotfix/x',
      'hotfix/a/b',
      RELEASE_PLEASE_HEAD,
      `${RELEASE_PLEASE_COMPONENT_PREFIX}tsuzuki`,
    ];
    for (const headRef of heads) {
      it(`allows ${headRef}`, () => {
        assert.equal(baseBranchViolation(pullRequest({ headRef })), null);
      });
    }
  });

  describe('heads rejected on main', () => {
    const heads = [
      ['a feature branch', 'feat/x'],
      ['a fix branch', 'fix/x'],
      ['a chore branch', 'chore/ci-pipeline'],
      ['a docs branch', 'docs/x'],
      ['a test branch', 'test/x'],
      ['a hotfix prefix with an empty suffix', 'hotfix/'],
      ['hotfix without a slash', 'hotfix'],
      ['capitalized Dev', 'Dev'],
      ['uppercase DEV', 'DEV'],
      ['dev with a digit suffix', 'dev2'],
      ['dev with a letter suffix', 'devx'],
      ['main itself', 'main'],
      ['a release-please branch for dev', 'release-please--branches--dev'],
      ['a bot branch', 'bot/x'],
      ['a release-please branch for another base', 'release-please--branches--mainline'],
      ['a release-please branch with a stray suffix', 'release-please--branches--main-x'],
      [
        'a release-please component prefix with an empty component',
        RELEASE_PLEASE_COMPONENT_PREFIX,
      ],
      ['a release-please singular component typo', 'release-please--branches--main--component--x'],
    ];
    for (const [name, headRef] of heads) {
      it(`rejects ${name} (${headRef})`, () => {
        const message = baseBranchViolation(pullRequest({ headRef }));
        assert.equal(typeof message, 'string');
        assert.ok(message.startsWith(`${headRef} cannot target ${PROTECTED_BASE}:`), message);
        assert.ok(message.endsWith(POLICY_SUFFIX), message);
      });
    }

    it('lists every head allowed to target main', () => {
      const message = baseBranchViolation(pullRequest({ headRef: 'feat/x' }));
      const allowed = `only dev, hotfix/*, ${RELEASE_PLEASE_HEAD} and ${RELEASE_PLEASE_COMPONENT_PREFIX}* target ${PROTECTED_BASE}`;
      assert.ok(message.includes(allowed), message);
    });
  });

  describe('forks', () => {
    const heads = ['dev', 'hotfix/x', RELEASE_PLEASE_HEAD];
    for (const headRef of heads) {
      it(`rejects ${headRef} from a fork to main`, () => {
        const message = baseBranchViolation(pullRequest({ headRef, headRepo: FORK }));
        assert.equal(typeof message, 'string');
        assert.ok(message.includes(`not from ${FORK}`), message);
        assert.ok(message.includes(REPOSITORY), message);
        assert.ok(message.endsWith(POLICY_SUFFIX), message);
      });
    }

    it('allows a fork branch to dev', () => {
      const request = pullRequest({ baseRef: 'dev', headRef: 'feat/x', headRepo: FORK });
      assert.equal(baseBranchViolation(request), null);
    });
  });

  describe('bases other than main', () => {
    const bases = ['dev', 'feature-base'];
    const heads = ['feat/x', 'main', 'dev', 'hotfix/x', 'bot/x'];
    for (const baseRef of bases) {
      for (const headRef of heads) {
        it(`allows ${headRef} to ${baseRef}`, () => {
          assert.equal(baseBranchViolation(pullRequest({ baseRef, headRef })), null);
        });
      }
    }
  });

  describe('fails closed on missing metadata', () => {
    const invalidValues = [
      ['undefined', undefined],
      ['empty', ''],
      ['whitespace-only', ' \t\n'],
      ['a number', 42],
      ['null', null],
    ];
    for (const key of INPUT_KEYS) {
      for (const [name, value] of invalidValues) {
        it(`rejects ${key} when it is ${name}`, () => {
          assert.equal(baseBranchViolation(pullRequest({ [key]: value })), missingMessage([key]));
        });
      }
    }

    it('lists every missing key in declaration order', () => {
      assert.equal(baseBranchViolation({}), missingMessage(INPUT_KEYS));
    });

    it('checks the metadata before the base branch', () => {
      const request = pullRequest({ baseRef: 'dev', headRepo: '' });
      assert.equal(baseBranchViolation(request), missingMessage(['headRepo']));
    });
  });
});

// only the policy variables, plus SystemRoot which node needs on windows: nothing leaks from the
// parent environment (a BASE_REF set by the runner would make the tests order or host dependent)
const runCli = (variables) => {
  const env = { ...variables };
  if (process.env.SystemRoot !== undefined) {
    env.SystemRoot = process.env.SystemRoot;
  }
  return spawnSync(process.execPath, [CLI], { env, encoding: 'utf8' });
};

const cliVariables = (overrides = {}) => ({
  BASE_REF: PROTECTED_BASE,
  HEAD_REF: MAIN_HEADS.release,
  HEAD_REPO: REPOSITORY,
  REPOSITORY,
  ...overrides,
});

describe('check-base-branch cli', () => {
  it('exits 0 and prints the OK line for an allowed pull request', () => {
    const { status, stdout, stderr } = runCli(cliVariables());
    assert.equal(status, SUCCESS_EXIT_CODE, stderr);
    assert.equal(stdout, `base branch policy OK: ${REPOSITORY}:dev -> ${PROTECTED_BASE}\n`);
    assert.equal(stderr, '');
  });

  it('exits 1 with an error annotation for a rejected pull request', () => {
    const { status, stdout, stderr } = runCli(cliVariables({ HEAD_REF: 'feat/x' }));
    assert.equal(status, FAILURE_EXIT_CODE);
    assert.equal(stdout, '');
    assert.ok(stderr.startsWith(`${ERROR_PREFIX}feat/x cannot target main:`), stderr);
    assert.ok(stderr.endsWith(`${POLICY_SUFFIX}\n`), stderr);
  });

  it('escapes %, CR and LF so a head ref stays inside one annotation', () => {
    const { status, stderr } = runCli(cliVariables({ HEAD_REF: 'feat/100%\r\n::warning::x' }));
    assert.equal(status, FAILURE_EXIT_CODE);
    const lines = stderr.split('\n');
    assert.equal(lines.length, 2, stderr);
    assert.equal(lines[1], '');
    assert.ok(
      stderr.startsWith(`${ERROR_PREFIX}feat/100%25%0D%0A::warning::x cannot target main:`),
      stderr,
    );
    assert.equal(stderr.includes('\r'), false);
  });

  it('exits 1 on a fork branch named dev targeting main', () => {
    const { status, stderr } = runCli(cliVariables({ HEAD_REPO: FORK }));
    assert.equal(status, FAILURE_EXIT_CODE);
    assert.ok(stderr.includes(`not from ${FORK}`), stderr);
  });

  it('exits 1 when one variable is missing', () => {
    const variables = cliVariables();
    delete variables.HEAD_REPO;
    const { status, stdout, stderr } = runCli(variables);
    assert.equal(status, FAILURE_EXIT_CODE);
    assert.equal(stdout, '');
    assert.equal(stderr, `${ERROR_PREFIX}${missingMessage(['headRepo'])}\n`);
  });

  it('exits 1 and lists every key when the environment is empty', () => {
    const { status, stderr } = runCli({});
    assert.equal(status, FAILURE_EXIT_CODE);
    assert.equal(stderr, `${ERROR_PREFIX}${missingMessage(INPUT_KEYS)}\n`);
  });
});
