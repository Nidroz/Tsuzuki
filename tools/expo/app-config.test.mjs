// tests of app.config.ts as the expo cli loads it (ADR-0012): the app id and name per variant, the
// validated env in extra.env, and the build failing on an invalid env. each case loads the config
// with expo's own loader in a child node process with its own environment: the config reads
// process.env once, at load, and the resolve hook it registers never leaks into the test runner

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SUCCESS_EXIT_CODE = 0;
const APP_ID = 'io.github.nidroz.tsuzuki';

// placeholder values that pass the app env schema: none of them is a real project or key
const VALID_ENV = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_placeholder',
};
const VALID_DSN = 'https://0123abcd@o1.ingest.de.sentry.io/42';

// every variable the config reads: removed from the inherited environment so the developer's
// shell (or ci) cannot change the outcome
const CONFIG_ENV_NAMES = [
  'APP_VARIANT',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'SENTRY_DSN',
  'EAS_BUILD',
];

// prints the fields under test as json, or the error name and message
const LOAD_CONFIG = `
  const { getConfig } = require('expo/config');
  try {
    const { exp } = getConfig(process.cwd(), { skipSDKVersionRequirement: true });
    process.stdout.write(JSON.stringify({
      name: exp.name,
      ios: exp.ios?.bundleIdentifier,
      android: exp.android?.package,
      extra: exp.extra,
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error.message) }));
  }
`;

const loadConfig = (env) => {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !CONFIG_ENV_NAMES.includes(name)),
  );
  const result = spawnSync(process.execPath, ['-e', LOAD_CONFIG], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
  assert.equal(result.status, SUCCESS_EXIT_CODE, result.stderr);
  return JSON.parse(result.stdout);
};

describe('app.config.ts', () => {
  for (const [variant, idSuffix, name] of [
    ['development', '.dev', 'Tsuzuki (Dev)'],
    ['preview', '.preview', 'Tsuzuki (Preview)'],
    ['production', '', 'Tsuzuki'],
  ]) {
    it(`gives the ${variant} variant its own app id and name, and its env in extra.env`, () => {
      const config = loadConfig({ ...VALID_ENV, APP_VARIANT: variant });

      assert.equal(config.error, undefined);
      assert.equal(config.name, name);
      assert.equal(config.ios, `${APP_ID}${idSuffix}`);
      assert.equal(config.android, `${APP_ID}${idSuffix}`);
      assert.deepEqual(config.extra.env, {
        variant,
        supabaseUrl: VALID_ENV.EXPO_PUBLIC_SUPABASE_URL,
        supabaseAnonKey: VALID_ENV.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      });
    });
  }

  it('keeps a valid sentry dsn in extra.env', () => {
    const config = loadConfig({ ...VALID_ENV, APP_VARIANT: 'production', SENTRY_DSN: VALID_DSN });

    assert.equal(config.extra.env.sentryDsn, VALID_DSN);
  });

  it('falls back to the development app id and leaves extra.env out without any env', () => {
    const config = loadConfig({});

    assert.equal(config.error, undefined);
    assert.equal(config.android, `${APP_ID}.dev`);
    assert.equal(config.name, 'Tsuzuki (Dev)');
    assert.equal('env' in config.extra, false);
    assert.equal(typeof config.extra.eas.projectId, 'string');
  });

  it('fails on an eas build without any env', () => {
    const config = loadConfig({ EAS_BUILD: 'true' });

    assert.match(config.error, /Invalid app env: .*supabaseUrl/);
  });

  it('picks the variant from APP_VARIANT alone off the eas build worker, without extra.env', () => {
    const config = loadConfig({ APP_VARIANT: 'preview' });

    assert.equal(config.error, undefined);
    assert.equal(config.name, 'Tsuzuki (Preview)');
    assert.equal(config.ios, `${APP_ID}.preview`);
    assert.equal(config.android, `${APP_ID}.preview`);
    assert.equal('env' in config.extra, false);
  });

  it('validates the env with the development variant when APP_VARIANT is missing', () => {
    const config = loadConfig(VALID_ENV);

    assert.equal(config.error, undefined);
    assert.equal(config.android, `${APP_ID}.dev`);
    assert.equal(config.extra.env.variant, 'development');
    assert.equal(config.extra.env.supabaseUrl, VALID_ENV.EXPO_PUBLIC_SUPABASE_URL);
  });

  it('fails on an eas build with APP_VARIANT only, naming the missing fields', () => {
    const config = loadConfig({ EAS_BUILD: 'true', APP_VARIANT: 'preview' });

    assert.match(config.error, /Invalid app env: supabaseUrl, supabaseAnonKey$/);
  });

  for (const env of [{}, VALID_ENV]) {
    const label = env === VALID_ENV ? 'with' : 'without';
    it(`fails on an invalid APP_VARIANT ${label} the supabase env, without printing it`, () => {
      const config = loadConfig({ ...env, APP_VARIANT: 'staging' });

      assert.equal(config.error?.endsWith('Invalid app env: variant'), true, config.error);
      assert.equal(config.error.includes('staging'), false);
    });
  }

  it('fails on a partial local env off the eas build worker', () => {
    const config = loadConfig({
      APP_VARIANT: 'preview',
      EXPO_PUBLIC_SUPABASE_URL: VALID_ENV.EXPO_PUBLIC_SUPABASE_URL,
    });

    assert.match(config.error, /Invalid app env: supabaseAnonKey$/);
  });

  it('fails on an http supabase url, naming the field but not its value', () => {
    const insecureUrl = 'http://placeholder.supabase.co';
    const config = loadConfig({
      ...VALID_ENV,
      APP_VARIANT: 'preview',
      EXPO_PUBLIC_SUPABASE_URL: insecureUrl,
    });

    assert.match(config.error, /Invalid app env: supabaseUrl/);
    assert.doesNotMatch(config.error, /placeholder\.supabase\.co/);
  });

  it('fails on a secret supabase key, without printing it', () => {
    const secretKey = 'sb_secret_placeholder';
    const config = loadConfig({
      ...VALID_ENV,
      APP_VARIANT: 'production',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: secretKey,
    });

    assert.match(config.error, /Invalid app env: supabaseAnonKey/);
    assert.equal(config.error.includes(secretKey), false);
  });
});
