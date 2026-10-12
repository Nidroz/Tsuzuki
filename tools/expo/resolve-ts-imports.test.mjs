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
const FIXTURES = path.join(import.meta.dirname, '__fixtures__', 'resolve-ts-imports');
// the first import of the fixture app config
const GRAPH_SPECIFIER = './graph/first';

// runs a commonjs script with the hook between two probe hooks, in a child process: INNER (when
// set) runs below the hook, as its nextResolve; the formats the hook resolves to are recorded by
// the outer probe as FORMATS, keyed by file name. the script imports the fixtures with load(name)
const HOOK_HARNESS = `
  const { registerHooks } = require('node:module');
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const INNER = process.env.INNER ? JSON.parse(process.env.INNER) : {};
  const RETRIED = [];
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.ts') && specifier.startsWith('./')) RETRIED.push(specifier);
      const failure = INNER[specifier];
      if (failure) throw Object.assign(new Error(failure.message), { code: failure.code });
      return nextResolve(specifier, context);
    },
  });
  require(process.env.HOOK);
  const FORMATS = {};
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context);
      FORMATS[path.basename(resolved.url)] = resolved.format ?? null;
      return resolved;
    },
  });
  const load = (name) => import(pathToFileURL(path.join(process.env.FIXTURES, name)).href);
`;

const runHarness = (body, inner) =>
  spawnSync(
    process.execPath,
    [
      '-e',
      `${HOOK_HARNESS}
(async () => {
${body}
})();`,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOOK,
        FIXTURES,
        ...(inner && { INNER: JSON.stringify(inner) }),
      },
    },
  );

// the error the fixture app config fails to load with, as { name, code, message }, and the ".ts"
// specifiers the inner probe saw
const LOAD_FAILURE = `
  try {
    await load('app.config.ts');
    process.stdout.write('loaded');
  } catch (error) {
    process.stdout.write(JSON.stringify({ code: error.code, message: error.message, retried: RETRIED }));
  }
`;

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

  it('resolves the app config graph, transitively, as typescript es modules', () => {
    const result = runHarness(
      `const { config } = await load('app.config.ts');
       process.stdout.write(JSON.stringify({ config, formats: FORMATS }));`,
    );
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    const { config, formats } = JSON.parse(result.stdout);
    assert.equal(config, 'first-second');
    assert.equal(formats['first.ts'], 'module-typescript');
    assert.equal(formats['second.ts'], 'module-typescript');
  });

  it('retries an extensionless import outside the app config graph without forcing its format', () => {
    const result = runHarness(
      `const { unrelated } = await load('unrelated.ts');
       process.stdout.write(JSON.stringify({ unrelated, formats: FORMATS }));`,
    );
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    const { unrelated, formats } = JSON.parse(result.stdout);
    assert.equal(unrelated, 'unrelated');
    assert.notEqual(formats['unrelated.ts'], 'module-typescript');
    assert.notEqual(formats['unrelated-dependency.ts'], 'module-typescript');
  });

  it('rethrows a failure other than a module not found unchanged, without a retry', () => {
    const result = runHarness(LOAD_FAILURE, {
      [GRAPH_SPECIFIER]: { code: 'ERR_PROBE', message: 'probe failure' },
    });
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: 'ERR_PROBE',
      message: 'probe failure',
      retried: [],
    });
  });

  it('rethrows the original not found error when the ".ts" retry fails too', () => {
    const result = runHarness(LOAD_FAILURE, {
      [GRAPH_SPECIFIER]: { code: 'ERR_MODULE_NOT_FOUND', message: 'original not found' },
      [`${GRAPH_SPECIFIER}.ts`]: { code: 'ERR_MODULE_NOT_FOUND', message: 'retry not found' },
    });
    assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      code: 'ERR_MODULE_NOT_FOUND',
      message: 'original not found',
      retried: [`${GRAPH_SPECIFIER}.ts`],
    });
  });
});
