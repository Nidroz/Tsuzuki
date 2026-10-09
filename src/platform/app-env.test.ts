import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppEnvError } from '@core/errors/app-env-error';
import type { AppEnv } from '@core/schemas/app-env';

import { readAppEnv } from './app-env';

// replaces the env the mobile setup provides: each case sets its own manifest
let mockExpoConfig: { extra?: Record<string, unknown> } | null = null;

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

const VALID_ENV: AppEnv = {
  variant: 'production',
  supabaseUrl: 'https://ref.supabase.co',
  supabaseAnonKey: 'sb_publishable_key',
  sentryDsn: 'https://0123abcd@o1.ingest.de.sentry.io/42',
};
const SECRET_KEY = 'sb_secret_do-not-ship';

// stands in for the core parseAppEnv (src/platform may import core types only; the parser itself
// is tested in src/core/schemas/app-env.test.ts): accepts the valid env, throws like the core
// parser otherwise, naming the field only
const fakeParse = jest.fn((input: unknown): AppEnv => {
  if (input === undefined) throw new AppEnvError(['env']);
  const { supabaseAnonKey } = input as { supabaseAnonKey?: unknown };
  if (supabaseAnonKey !== VALID_ENV.supabaseAnonKey) throw new AppEnvError(['supabaseAnonKey']);
  return VALID_ENV;
});

beforeEach(() => {
  mockExpoConfig = null;
  fakeParse.mockClear();
});

describe('readAppEnv', () => {
  it('passes extra.env to the parser and returns the parsed env', () => {
    const raw = { ...VALID_ENV, unknownField: 'ignored by the parser' };
    mockExpoConfig = { extra: { eas: { projectId: 'id' }, env: raw } };

    expect(readAppEnv(fakeParse)).toBe(VALID_ENV);
    expect(fakeParse).toHaveBeenCalledWith(raw);
  });

  it.each([
    ['no manifest', null],
    ['no extra', {}],
    ['no extra.env', { extra: { eas: { projectId: 'id' } } }],
  ])('fails closed with %s', (_, config) => {
    mockExpoConfig = config;

    expect(() => readAppEnv(fakeParse)).toThrow(new AppEnvError(['env']));
    expect(fakeParse).toHaveBeenCalledWith(undefined);
  });

  it('lets the AppEnvError of an invalid env through, without the value', () => {
    mockExpoConfig = { extra: { env: { ...VALID_ENV, supabaseAnonKey: SECRET_KEY } } };

    let thrown: unknown;
    try {
      readAppEnv(fakeParse);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppEnvError);
    expect(thrown).toHaveProperty('fields', ['supabaseAnonKey']);
    expect(thrown).toHaveProperty('message', 'Invalid app env: supabaseAnonKey');
    expect(String(thrown)).not.toContain(SECRET_KEY);
  });
});
