// publishes an eas update for one app variant: `pnpm update:publish <variant> [eas update flags]`.
// off the eas build worker, app.config.ts leaves extra.env out when no supabase, sentry or catalog
// value is set, so an update published without its eas environment would fail closed at startup.
// this wrapper always passes the variant as both the channel and the eas environment (eas.json)

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// the app variants of src/core/schemas/app-env.ts (APP_VARIANTS), which are also the eas.json
// build profiles, channels and eas environments. node cannot import that typescript module here
// without the resolve hook of app.config.ts, so the list is repeated
export const UPDATE_VARIANTS = ['development', 'preview', 'production'];

// flags this wrapper sets from the variant: a different value is rejected
const VARIANT_FLAGS = ['--environment', '--channel'];

// flags that publish to a branch other than the channel's own: always rejected
const BYPASS_FLAGS = ['--branch', '--auto'];

const USAGE = `usage: pnpm update:publish <${UPDATE_VARIANTS.join('|')}> [eas update flags]`;

const FAILURE_EXIT_CODE = 1;

const ARGS_SEPARATOR = '--';

const JS_FILE = /\.[cm]?js$/;

export class UpdateArgsError extends Error {
  constructor(message) {
    super(`${message}\n${USAGE}`);
    this.name = 'UpdateArgsError';
  }
}

// the flag of an argument, for both `--flag value` and `--flag=value`
const flagOf = (arg) => arg.split('=', 1)[0];

/**
 * the eas cli arguments of an update for the variant given first: `update --channel <variant>
 * --environment <variant>`, then the other arguments. a missing or unknown variant, a --channel or
 * --environment other than the variant, or a --branch or --auto throws an UpdateArgsError
 */
export const buildUpdateArgs = (argv) => {
  // `pnpm update:publish -- preview` forwards the separator
  const [variant, ...rest] = argv[0] === ARGS_SEPARATOR ? argv.slice(1) : argv;
  if (variant === undefined || variant.startsWith('-')) {
    throw new UpdateArgsError('missing app variant');
  }
  if (!UPDATE_VARIANTS.includes(variant)) {
    throw new UpdateArgsError(`unknown app variant "${variant}"`);
  }
  const forwarded = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const flag = flagOf(arg);
    if (BYPASS_FLAGS.includes(flag)) {
      throw new UpdateArgsError(`${flag} is not allowed: updates go to the channel's branch`);
    }
    if (!VARIANT_FLAGS.includes(flag)) {
      forwarded.push(arg);
      continue;
    }
    // the value follows the = sign, or is the next argument
    const inline = arg.length > flag.length;
    const value = inline ? arg.slice(flag.length + 1) : rest[index + 1];
    if (!inline) index += 1;
    if (value !== variant) {
      throw new UpdateArgsError(
        `${flag} must be the app variant "${variant}", got ${value === undefined ? 'nothing' : `"${value}"`}`,
      );
    }
  }
  return ['update', '--channel', variant, '--environment', variant, ...forwarded];
};

/**
 * the command and leading arguments that run pnpm without a shell: the pnpm that runs this script
 * (npm_execpath, a javascript file run by node or a native executable), else pnpm from the path.
 * on windows, pnpm from the path is a .cmd shim that needs a shell: null, run it through pnpm
 */
export const pnpmCommand = ({ execPath, nodePath, platform }) => {
  if (execPath !== undefined && execPath !== '') {
    return JS_FILE.test(execPath)
      ? { command: nodePath, args: [execPath] }
      : { command: execPath, args: [] };
  }
  return platform === 'win32' ? null : { command: 'pnpm', args: [] };
};

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
};

const main = () => {
  let easArgs;
  try {
    easArgs = buildUpdateArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof UpdateArgsError) {
      fail(error.message);
      return;
    }
    throw error;
  }
  const pnpm = pnpmCommand({
    execPath: process.env.npm_execpath,
    nodePath: process.execPath,
    platform: process.platform,
  });
  if (pnpm === null) {
    fail(`pnpm not found: ${USAGE}`);
    return;
  }
  const result = spawnSync(pnpm.command, [...pnpm.args, 'exec', 'eas', ...easArgs], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    fail(`could not run eas: ${result.error.message}`);
    return;
  }
  process.exitCode = result.status ?? FAILURE_EXIT_CODE;
};

// run as a script, not when imported by its tests
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  main();
}
