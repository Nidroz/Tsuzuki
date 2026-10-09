import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AppEnv } from '@core/schemas/app-env';
import * as Sentry from '@sentry/react-native';

import { createErrorReporter, initSentry, isSentryEnabled } from './sentry';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrub';

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
}));

const DSN = 'https://0123abcd@o1.ingest.de.sentry.io/42';
const ENV: AppEnv = {
  variant: 'preview',
  supabaseUrl: 'https://ref.supabase.co',
  supabaseAnonKey: 'sb_publishable_key',
  sentryDsn: DSN,
};
const ENV_WITHOUT_DSN: AppEnv = {
  variant: ENV.variant,
  supabaseUrl: ENV.supabaseUrl,
  supabaseAnonKey: ENV.supabaseAnonKey,
};

// the mocks live as long as the file: each test starts without recorded calls
beforeEach(() => {
  jest.mocked(Sentry.init).mockClear();
  jest.mocked(Sentry.captureException).mockClear();
});

const RELEASE = false;
const DEVELOPMENT = true;

describe('isSentryEnabled', () => {
  it.each([
    ['a release build with a dsn', ENV, RELEASE, true],
    ['a development build with a dsn', ENV, DEVELOPMENT, false],
    ['a release build without a dsn', ENV_WITHOUT_DSN, RELEASE, false],
    ['a development build without a dsn', ENV_WITHOUT_DSN, DEVELOPMENT, false],
  ])('for %s', (_, env, isDevelopment, expected) => {
    expect(isSentryEnabled(env, isDevelopment)).toBe(expected);
  });

  it('follows __DEV__ by default (true under jest)', () => {
    expect(isSentryEnabled(ENV)).toBe(false);
  });
});

describe('initSentry', () => {
  it('does not start sentry in development', () => {
    expect(initSentry(ENV, DEVELOPMENT)).toBe(false);
    expect(initSentry(ENV)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('does not start sentry without a dsn', () => {
    expect(initSentry(ENV_WITHOUT_DSN, RELEASE)).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('starts sentry for errors only, without default pii, scrubbing every event', () => {
    expect(initSentry(ENV, RELEASE)).toBe(true);

    expect(Sentry.init).toHaveBeenCalledTimes(1);
    const options = jest.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: DSN,
      environment: 'preview',
      sendDefaultPii: false,
      enableAutoPerformanceTracing: false,
      enableCaptureFailedRequests: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
    });
    expect(options?.beforeSend).toBe(scrubEvent);
    expect(options?.beforeBreadcrumb).toBe(scrubBreadcrumb);
    // no tracing and no replay: no sample rate is set
    expect(options).not.toHaveProperty('tracesSampleRate');
    expect(options).not.toHaveProperty('tracesSampler');
    expect(options).not.toHaveProperty('replaysSessionSampleRate');
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate');
  });

  it.each(['development', 'preview', 'production'] as const)(
    'reports the %s variant as the sentry environment',
    (variant) => {
      initSentry({ ...ENV, variant }, RELEASE);

      expect(jest.mocked(Sentry.init).mock.calls[0]?.[0]?.environment).toBe(variant);
    },
  );
});

describe('createErrorReporter', () => {
  const error = new Error('boom');

  it('sends the error to sentry with the source and tags when sentry runs', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    createErrorReporter(true, RELEASE).captureError(error, {
      source: 'i18n',
      tags: { language: 'fr' },
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { language: 'fr', source: 'i18n' },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets the source win over a tag of the same name', () => {
    createErrorReporter(true, RELEASE).captureError(error, {
      source: 'theme',
      tags: { source: 'spoofed' },
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error, { tags: { source: 'theme' } });
  });

  it('sends an error without context to sentry without tags', () => {
    createErrorReporter(true, RELEASE).captureError(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });

  it('writes to the console in development, labelled with the source', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    createErrorReporter(false, DEVELOPMENT).captureError(error, { source: 'i18n' });
    createErrorReporter(false).captureError(error);

    expect(warn.mock.calls).toStrictEqual([
      ['[i18n]', error],
      ['[error]', error],
    ]);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports nothing in a release without sentry', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    createErrorReporter(false, RELEASE).captureError(error, { source: 'i18n' });

    expect(warn).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
