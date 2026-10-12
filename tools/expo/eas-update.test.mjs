// tests of the eas update wrapper: the eas cli arguments it builds from the app variant, the pnpm
// it runs, and its variant list kept in sync with the core app env schema

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

import { UPDATE_VARIANTS, UpdateArgsError, buildUpdateArgs, pnpmCommand } from './eas-update.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HOOK = path.join(import.meta.dirname, 'resolve-ts-imports.cjs');
const APP_ENV_SCHEMA = path.join(ROOT, 'src', 'core', 'schemas', 'app-env.ts');
const SUCCESS_EXIT_CODE = 0;
const VARIANT = 'preview';
const OTHER_VARIANT = 'production';

// the arguments every update for the variant starts with
const variantArgs = (variant) => ['update', '--channel', variant, '--environment', variant];

describe('buildUpdateArgs', () => {
  it('passes the variant as the channel and the eas environment, then the other arguments', () => {
    assert.deepEqual(buildUpdateArgs([VARIANT, '--message', 'fix crash', '--non-interactive']), [
      ...variantArgs(VARIANT),
      '--message',
      'fix crash',
      '--non-interactive',
    ]);
  });

  it('drops the leading separator pnpm forwards', () => {
    assert.deepEqual(buildUpdateArgs(['--', VARIANT, '--message', 'm']), [
      ...variantArgs(VARIANT),
      '--message',
      'm',
    ]);
  });

  it('accepts a channel or environment equal to the variant without repeating it', () => {
    assert.deepEqual(
      buildUpdateArgs([
        VARIANT,
        '--channel',
        VARIANT,
        `--environment=${VARIANT}`,
        '--message',
        'm',
      ]),
      [...variantArgs(VARIANT), '--message', 'm'],
    );
  });

  it('rejects a missing variant', () => {
    for (const argv of [[], ['--'], ['--message', 'm']]) {
      assert.throws(() => buildUpdateArgs(argv), {
        name: 'UpdateArgsError',
        message: /^missing app variant\nusage: pnpm update:publish/,
      });
    }
  });

  it('rejects an unknown variant', () => {
    assert.throws(() => buildUpdateArgs(['staging']), {
      name: 'UpdateArgsError',
      message: /^unknown app variant "staging"/,
    });
  });

  it('rejects a channel or environment other than the variant, in both flag forms', () => {
    const cases = [
      [
        ['--channel', OTHER_VARIANT],
        `--channel must be the app variant "${VARIANT}", got "${OTHER_VARIANT}"`,
      ],
      [
        [`--channel=${OTHER_VARIANT}`],
        `--channel must be the app variant "${VARIANT}", got "${OTHER_VARIANT}"`,
      ],
      [
        ['--environment', OTHER_VARIANT],
        `--environment must be the app variant "${VARIANT}", got "${OTHER_VARIANT}"`,
      ],
      [
        [`--environment=${OTHER_VARIANT}`],
        `--environment must be the app variant "${VARIANT}", got "${OTHER_VARIANT}"`,
      ],
      [['--environment'], `--environment must be the app variant "${VARIANT}", got nothing`],
    ];
    for (const [flags, message] of cases) {
      assert.throws(
        () => buildUpdateArgs([VARIANT, ...flags]),
        (error) => {
          assert.ok(error instanceof UpdateArgsError);
          assert.ok(error.message.startsWith(message), error.message);
          return true;
        },
      );
    }
  });

  it('rejects --branch in both flag forms and --auto', () => {
    for (const flags of [['--branch', 'hotfix'], ['--branch=hotfix'], ['--auto']]) {
      const flag = flags[0].split('=', 1)[0];
      assert.throws(() => buildUpdateArgs([VARIANT, ...flags, '--message', 'm']), {
        name: 'UpdateArgsError',
        message: new RegExp(`^${flag} is not allowed: updates go to the channel's branch\\n`),
      });
    }
  });
});

describe('pnpmCommand', () => {
  it('runs a javascript pnpm entry point with node', () => {
    assert.deepEqual(
      pnpmCommand({ execPath: '/pnpm/bin/pnpm.cjs', nodePath: '/bin/node', platform: 'linux' }),
      { command: '/bin/node', args: ['/pnpm/bin/pnpm.cjs'] },
    );
  });

  it('runs a native pnpm executable directly', () => {
    assert.deepEqual(
      pnpmCommand({ execPath: '/usr/bin/pnpm', nodePath: '/bin/node', platform: 'linux' }),
      { command: '/usr/bin/pnpm', args: [] },
    );
  });

  it('falls back to pnpm from the path, except on windows', () => {
    assert.deepEqual(pnpmCommand({ execPath: '', nodePath: '/bin/node', platform: 'linux' }), {
      command: 'pnpm',
      args: [],
    });
    assert.equal(pnpmCommand({ execPath: undefined, nodePath: 'node', platform: 'win32' }), null);
  });
});

describe('UPDATE_VARIANTS', () => {
  it('equals APP_VARIANTS of the core app env schema', () => {
    // the schema is typescript: loaded in a child process through the app config's resolve hook
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `require(process.env.HOOK);
         const { APP_VARIANTS } = require(process.env.APP_ENV_SCHEMA);
         process.stdout.write(JSON.stringify(APP_VARIANTS));`,
      ],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOOK, APP_ENV_SCHEMA } },
    );
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    assert.deepEqual(UPDATE_VARIANTS, JSON.parse(result.stdout));
  });
});
