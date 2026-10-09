import { describe, expect, it } from '@jest/globals';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

import { scrubBreadcrumb, scrubEvent, scrubRecord, scrubText, stripQuery } from './sentry-scrub';

// fake personal data and credentials: each one must be absent from every scrubbed payload
const EMAIL = 'jane.doe+anime@example.com';
const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWlkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ.c2lnbmF0dXJlLXZhbHVl';
const OPAQUE_TOKEN = 'opaque-refresh-token-1234';
const PUBLISHABLE_KEY = 'sb_publishable_AbCdEf123-xyz';
const SECRET_KEY = 'sb_secret_ZyXwV987_abc';
const COOKIE = 'sb-access-token=cookie-session-value';
const NOTE = 'rewatch episode 3 with my sister';
const USER_ID = 'user-id-42';
const IP_ADDRESS = '203.0.113.7';
const QUERY_SECRET = 'query-secret-value';

const SECRETS = [
  EMAIL,
  JWT,
  OPAQUE_TOKEN,
  PUBLISHABLE_KEY,
  SECRET_KEY,
  'cookie-session-value',
  NOTE,
  USER_ID,
  IP_ADDRESS,
  QUERY_SECRET,
  'request-body-value',
];

// every string of the payload, keys and values, in one text
const serialized = (value: unknown): string => JSON.stringify(value);

// the secrets still present in the payload: empty when scrubbing worked
const leakedSecrets = (value: unknown): string[] => {
  const text = serialized(value);
  return SECRETS.filter((secret) => text.includes(secret));
};

const STACK_FRAMES = [
  {
    filename: 'app:///index.bundle',
    function: 'fetchLibrary',
    lineno: 120,
    colno: 7,
    in_app: true,
  },
  { filename: 'app:///index.bundle', function: 'onPress', lineno: 48, colno: 3, in_app: true },
];

// an event carrying personal data and credentials everywhere sentry could put them
const leakyEvent = (): ErrorEvent => ({
  type: undefined,
  event_id: 'abc123',
  level: 'error',
  platform: 'javascript',
  environment: 'production',
  message: `sign in failed for ${EMAIL} with Bearer ${OPAQUE_TOKEN}`,
  exception: {
    values: [
      {
        type: 'AuthApiError',
        value: `invalid token ${JWT} for ${EMAIL}, key ${SECRET_KEY}`,
        mechanism: { type: 'onerror', handled: false },
        stacktrace: { frames: STACK_FRAMES },
      },
    ],
  },
  tags: { source: 'library', variant: 'production' },
  extra: {
    email: EMAIL,
    detail: `contact ${EMAIL}`,
    libraryItem: { mediaId: 'anilist:21', progress: 3, notes: NOTE },
    headers: { apikey: PUBLISHABLE_KEY },
  },
  contexts: {
    auth: { access_token: JWT, refresh_token: OPAQUE_TOKEN, reason: `expired for ${EMAIL}` },
    app: { app_version: '0.1.0' },
  },
  user: { id: USER_ID, email: EMAIL, ip_address: IP_ADDRESS },
  request: {
    method: 'POST',
    url: `https://ref.supabase.co/auth/v1/token?grant_type=password&apikey=${QUERY_SECRET}#access_token=${JWT}`,
    headers: {
      Authorization: `Bearer ${JWT}`,
      apikey: PUBLISHABLE_KEY,
      Cookie: COOKIE,
      'Content-Type': 'application/json',
    },
    data: { email: EMAIL, password: 'request-body-value' },
    query_string: `apikey=${QUERY_SECRET}`,
    cookies: { 'sb-access-token': 'cookie-session-value' },
  },
  breadcrumbs: [
    {
      category: 'fetch',
      type: 'http',
      data: { method: 'GET', url: `https://ref.supabase.co/rest/v1/items?apikey=${QUERY_SECRET}` },
    },
  ],
});

describe('scrubEvent', () => {
  it('drops or replaces every email, token, key, cookie, user field and note', () => {
    expect(leakedSecrets(scrubEvent(leakyEvent()))).toStrictEqual([]);
  });

  it('drops the user, the request body, cookies and query string, and auth headers', () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request).toStrictEqual({
      method: 'POST',
      url: 'https://ref.supabase.co/auth/v1/token',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(scrubbed.extra).toStrictEqual({
      detail: 'contact [email]',
      libraryItem: { mediaId: 'anilist:21', progress: 3 },
      headers: {},
    });
    expect(scrubbed.contexts?.['auth']).toStrictEqual({ reason: 'expired for [email]' });
  });

  it('keeps the non-personal content: error type, stack frames, tags, level, contexts', () => {
    const scrubbed = scrubEvent(leakyEvent());
    const exception = scrubbed.exception?.values?.[0];

    expect(exception?.type).toBe('AuthApiError');
    expect(exception?.stacktrace?.frames).toStrictEqual(STACK_FRAMES);
    expect(exception?.mechanism).toStrictEqual({ type: 'onerror', handled: false });
    expect(scrubbed.tags).toStrictEqual({ source: 'library', variant: 'production' });
    expect(scrubbed.level).toBe('error');
    expect(scrubbed.environment).toBe('production');
    expect(scrubbed.event_id).toBe('abc123');
    expect(scrubbed.contexts?.['app']).toStrictEqual({ app_version: '0.1.0' });
    expect(scrubbed.type).toBeUndefined();
  });

  it('replaces the secrets inside the message and the exception value, keeping the rest', () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed.message).toBe('sign in failed for [email] with Bearer [token]');
    expect(scrubbed.exception?.values?.[0]?.value).toBe(
      'invalid token [jwt] for [email], key [key]',
    );
  });

  it('scrubs the breadcrumbs attached to the event', () => {
    const scrubbed = scrubEvent(leakyEvent());

    expect(scrubbed.breadcrumbs?.[0]?.data).toStrictEqual({
      method: 'GET',
      url: 'https://ref.supabase.co/rest/v1/items',
    });
  });

  it('does not mutate the original event', () => {
    const event = leakyEvent();

    scrubEvent(event);

    expect(event).toStrictEqual(leakyEvent());
  });

  it('accepts an event without request', () => {
    const event = leakyEvent();
    delete event.request;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('request');
    expect(leakedSecrets(scrubbed)).toStrictEqual([]);
  });
});

describe('scrubBreadcrumb', () => {
  it.each([
    ['fetch', 'http'],
    ['xhr', 'http'],
  ])('drops the query string and fragment of a %s breadcrumb url', (category, type) => {
    const breadcrumb: Breadcrumb = {
      category,
      type,
      data: {
        method: 'GET',
        status_code: 401,
        url: `https://ref.supabase.co/auth/v1/user?email=${EMAIL}&token=${QUERY_SECRET}#access_token=${JWT}`,
      },
    };

    const scrubbed = scrubBreadcrumb(breadcrumb);

    expect(scrubbed).toStrictEqual({
      category,
      type,
      data: { method: 'GET', status_code: 401, url: 'https://ref.supabase.co/auth/v1/user' },
    });
    expect(leakedSecrets(scrubbed)).toStrictEqual([]);
  });

  it('scrubs a console breadcrumb message and its arguments', () => {
    const breadcrumb: Breadcrumb = {
      category: 'console',
      level: 'warning',
      message: `signed in as ${EMAIL} using ${PUBLISHABLE_KEY}`,
      data: { logger: 'console', arguments: [`signed in as ${EMAIL}`, { session: JWT }] },
    };

    const scrubbed = scrubBreadcrumb(breadcrumb);

    expect(scrubbed.message).toBe('signed in as [email] using [key]');
    expect(scrubbed.data).toStrictEqual({
      logger: 'console',
      arguments: ['signed in as [email]', {}],
    });
    expect(leakedSecrets(scrubbed)).toStrictEqual([]);
  });

  it('strips the query of navigation from and to urls', () => {
    const scrubbed = scrubBreadcrumb({
      category: 'navigation',
      data: { from: `/auth/callback?code=${QUERY_SECRET}`, to: '/library?tab=watching' },
    });

    expect(scrubbed.data).toStrictEqual({ from: '/auth/callback', to: '/library' });
  });

  it('keeps a breadcrumb without personal data unchanged', () => {
    const breadcrumb: Breadcrumb = {
      category: 'ui.click',
      message: 'tab-library',
      timestamp: 1_700_000_000,
    };

    expect(scrubBreadcrumb(breadcrumb)).toStrictEqual(breadcrumb);
  });
});

describe('scrubText', () => {
  it.each([
    [`mail ${EMAIL} now`, 'mail [email] now'],
    [`authorization: bearer ${OPAQUE_TOKEN}`, 'authorization: Bearer [token]'],
    [`Bearer ${JWT}`, 'Bearer [jwt]'],
    [`keys ${PUBLISHABLE_KEY} and ${SECRET_KEY}`, 'keys [key] and [key]'],
    [`/cb#access_token=${QUERY_SECRET}&type=recovery`, '/cb#access_token=[Filtered]&type=recovery'],
    ['episode 12 of 24', 'episode 12 of 24'],
  ])('scrubs %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    [
      `new row violates check constraint. Failing row contains (id-1, ${USER_ID}, ${NOTE} (sic), 3).`,
      'new row violates check constraint. Failing row contains [Filtered]',
    ],
    [
      `insert failed: {"notes":"${NOTE}","progress":3}`,
      'insert failed: {"notes":"[Filtered]","progress":3}',
    ],
    [
      `patch {"userNote" : "say \\"${NOTE}\\" twice", "id": 1}`,
      'patch {"userNote" : "[Filtered]", "id": 1}',
    ],
    [
      `body {"refresh_token":"${OPAQUE_TOKEN}","ok":true}`,
      'body {"refresh_token":"[Filtered]","ok":true}',
    ],
  ])('redacts the notes and secrets inside the string %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    ['/auth?redirect=john%40example.com&x=1', '/auth?redirect=[email]&x=1'],
    ['twice encoded john%2540example.com', 'twice encoded [email]'],
  ])('redacts the percent-encoded email in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    [`token: ${OPAQUE_TOKEN}`, 'token: [Filtered]'],
    [`token=${OPAQUE_TOKEN} retry`, 'token=[Filtered] retry'],
    ['Authorization: Basic dXNlcjpwYXNzd29yZA==', 'Authorization: Basic [token]'],
    [`form refresh_token=${OPAQUE_TOKEN}&grant=1`, 'form refresh_token=[Filtered]&grant=1'],
    [`got access_token=${OPAQUE_TOKEN}, retrying`, 'got access_token=[Filtered], retrying'],
    [`X-Refresh-Token: '${OPAQUE_TOKEN}'`, "X-Refresh-Token: '[Filtered]'"],
    [`password = ${OPAQUE_TOKEN}`, 'password = [Filtered]'],
  ])('redacts the credential in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each(['token expired', 'basic information', 'the secret ending'])(
    'keeps the plain text %j',
    (input) => {
      expect(scrubText(input)).toBe(input);
    },
  );

  it.each([
    ['a long word', 'a'.repeat(100_000)],
    ['a long dotted word', 'a.'.repeat(50_000)],
    ['an unterminated json string', `{"notes":"${'\\'.repeat(100_000)}`],
    ['a long key run', `${'token_'.repeat(20_000)}x`],
    ['a long percent run', '%40'.repeat(30_000)],
  ])('scrubs %s in linear time', (_, input) => {
    expect(typeof scrubText(input)).toBe('string');
  });
});

describe('stripQuery', () => {
  it.each([
    ['https://a.co/p?x=1', 'https://a.co/p'],
    ['https://a.co/p#frag', 'https://a.co/p'],
    ['https://a.co/p', 'https://a.co/p'],
  ])('turns %j into %j', (input, expected) => {
    expect(stripQuery(input)).toBe(expected);
  });
});

describe('scrubRecord', () => {
  it.each(['Authorization', 'X-Api-Key', 'set-cookie', 'accessToken', 'provider_refresh_token'])(
    'drops the key %j whatever its case and separators',
    (key) => {
      expect(scrubRecord({ [key]: 'value', kept: 1 })).toStrictEqual({ kept: 1 });
    },
  );

  it.each([
    'userNotes',
    'userEmail',
    'X-Refresh-Token',
    'SESSION_TOKEN',
    'dbPassword',
    'clientSecret',
    'x-authorization-hint',
    'sessionCookie',
    'myApiKey',
  ])('drops the key %j containing a sensitive word anywhere', (key) => {
    expect(scrubRecord({ [key]: 'value', kept: 1 })).toStrictEqual({ kept: 1 });
  });

  it('stops at the depth limit instead of following a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;

    expect(() => scrubRecord(cyclic)).not.toThrow();
    expect(serialized(scrubRecord(cyclic))).toContain('"name":"root"');
  });

  it('keeps numbers, booleans and null as they are', () => {
    expect(scrubRecord({ count: 0, ok: false, empty: null })).toStrictEqual({
      count: 0,
      ok: false,
      empty: null,
    });
  });
});
