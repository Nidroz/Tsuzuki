import { describe, expect, it } from '@jest/globals';

import { AppEnvError } from '../errors/app-env-error';
import { APP_VARIANTS, parseAppEnv } from './app-env';

const toBase64Url = (value: string): string =>
  btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const jwt = (payload: unknown): string =>
  [
    toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    toBase64Url(JSON.stringify(payload)),
    'signature',
  ].join('.');

const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_AbC123_x-Y'; // gitleaks:allow
const SECRET_KEY = 'sb_secret_AbC123';
const SENTRY_DSN = 'https://0123abcdef@o12345.ingest.de.sentry.io/678';

const VALID_ENV = {
  supabaseUrl: SUPABASE_URL,
  supabaseAnonKey: PUBLISHABLE_KEY,
  sentryDsn: SENTRY_DSN,
  variant: 'production',
};

const parseError = (input: unknown): AppEnvError => {
  try {
    parseAppEnv(input);
  } catch (error) {
    if (error instanceof AppEnvError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected parseAppEnv to throw');
};

describe('parseAppEnv', () => {
  it('parses a valid env', () => {
    expect(parseAppEnv(VALID_ENV)).toStrictEqual(VALID_ENV);
  });

  it.each(APP_VARIANTS)('accepts the %s variant', (variant) => {
    expect(parseAppEnv({ ...VALID_ENV, variant }).variant).toBe(variant);
  });

  it.each([
    ['an unknown variant', 'staging'],
    ['a missing variant', undefined],
  ])('rejects %s', (_case, variant) => {
    expect(parseError({ ...VALID_ENV, variant }).fields).toStrictEqual(['variant']);
  });

  describe('supabaseUrl', () => {
    it.each([SUPABASE_URL, `${SUPABASE_URL}/`, 'https://staging.example.com:8443'])(
      'accepts %s',
      (supabaseUrl) => {
        expect(parseAppEnv({ ...VALID_ENV, supabaseUrl }).supabaseUrl).toBe(supabaseUrl);
      },
    );

    it.each([
      ['http', 'http://abcdefgh.supabase.co'],
      ['another scheme', 'ftp://abcdefgh.supabase.co'],
      ['credentials', 'https://user:pass@abcdefgh.supabase.co'],
      ['a path or query', 'https://abcdefgh.supabase.co/rest?x=1'],
      ['an empty string', ''],
    ])('rejects a url with %s', (_case, supabaseUrl) => {
      expect(parseError({ ...VALID_ENV, supabaseUrl }).fields).toStrictEqual(['supabaseUrl']);
    });
  });

  describe('supabaseAnonKey', () => {
    it('accepts a legacy anon jwt', () => {
      const supabaseAnonKey = jwt({ iss: 'supabase', role: 'anon' });
      expect(parseAppEnv({ ...VALID_ENV, supabaseAnonKey }).supabaseAnonKey).toBe(supabaseAnonKey);
    });

    it.each([
      ['an empty key', ''],
      ['a secret key', SECRET_KEY],
      ['a service_role jwt', jwt({ iss: 'supabase', role: 'service_role' })],
      ['a jwt without role', jwt({ iss: 'supabase' })],
      ['a jwt with an unreadable payload', 'header.!!!.signature'],
      ['a jwt whose payload is not json', `header.${toBase64Url('not json')}.signature`],
      ['a malformed publishable key', 'sb_publishable_a b'],
    ])('rejects %s', (_case, supabaseAnonKey) => {
      expect(parseError({ ...VALID_ENV, supabaseAnonKey }).fields).toStrictEqual([
        'supabaseAnonKey',
      ]);
    });
  });

  describe('sentryDsn', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
    ])('is omitted when %s', (_case, sentryDsn) => {
      const env = parseAppEnv({ ...VALID_ENV, sentryDsn });
      expect(env).not.toHaveProperty('sentryDsn');
    });

    it.each([
      ['http', 'http://0123abcdef@o12345.ingest.de.sentry.io/678'],
      ['no project id', 'https://0123abcdef@o12345.ingest.de.sentry.io/'],
      ['no public key', 'https://o12345.ingest.de.sentry.io/678'],
    ])('rejects a dsn with %s', (_case, sentryDsn) => {
      expect(parseError({ ...VALID_ENV, sentryDsn }).fields).toStrictEqual(['sentryDsn']);
    });
  });

  it('lists every invalid field without leaking values', () => {
    const error = parseError({ supabaseUrl: 'http://x', supabaseAnonKey: SECRET_KEY });
    expect(error.fields).toStrictEqual(['supabaseUrl', 'supabaseAnonKey', 'variant']);
    expect(error.message).toBe('Invalid app env: supabaseUrl, supabaseAnonKey, variant');
    expect(error.message).not.toContain(SECRET_KEY);
    expect(error.name).toBe('AppEnvError');
  });

  it.each([null, 'env', 42])('rejects a non-object input (%p)', (input) => {
    expect(parseError(input).fields).toStrictEqual(['env']);
  });
});
