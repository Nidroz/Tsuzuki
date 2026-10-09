// regression tests for the resolve hook that lets app.config.ts load the core app env schema: each
// case runs in a child node process, so the hook never leaks into the test runner

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const HOOK = path.join(import.meta.dirname, 'resolve-ts-imports.cjs');
const APP_ENV_SCHEMA = path.join(ROOT, 'src', 'core', 'schemas', 'app-env.ts');
const SUCCESS_EXIT_CODE = 0;

// runs a commonjs script that loads the schema as parseAppEnv, in a child process, with or without
// the hook
const LOAD_SCHEMA = `
  if (process.env.WITH_HOOK === 'true') require(process.env.HOOK);
  const { parseAppEnv } = require(process.env.APP_ENV_SCHEMA);
`;

const runWith = (body, withHook) =>
  spawnSync(
    process.execPath,
    [
      '-e',
      `${LOAD_SCHEMA}
${body}`,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOOK, APP_ENV_SCHEMA, WITH_HOOK: String(withHook) },
    },
  );

describe('resolve-ts-imports', () => {
  it('loads the core schema and its extensionless imports', () => {
    const result = runWith(
      `const env = parseAppEnv({ variant: 'preview', supabaseUrl: 'https://ref.supabase.co', supabaseAnonKey: 'sb_publishable_key' });
       process.stdout.write(env.variant);`,
      true,
    );
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    assert.equal(result.stdout, 'preview');
  });

  it('keeps the schema errors: an invalid env throws an AppEnvError naming the fields', () => {
    const result = runWith(
      `try { parseAppEnv({ variant: 'staging' }); } catch (error) { process.stdout.write(error.name + ': ' + error.message); }`,
      true,
    );
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    assert.equal(
      result.stdout,
      'AppEnvError: Invalid app env: supabaseUrl, supabaseAnonKey, variant',
    );
  });

  it('is needed: without it, node does not resolve the extensionless import', () => {
    const result = runWith('', false);
    assert.notEqual(result.status, SUCCESS_EXIT_CODE);
    assert.match(result.stderr, /app-env-error/);
  });
});
