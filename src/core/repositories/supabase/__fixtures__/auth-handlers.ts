// msw handlers of the supabase auth endpoints and a real supabase-js client over an in-memory
// SessionStorage, for the auth repository tests. responses follow the gotrue api: error bodies with
// `code` and the api version header supabase-js needs to read it
import { jest } from '@jest/globals';
import { http, HttpResponse, type HttpHandler } from 'msw';

import type { ErrorReporter } from '../../../errors/error-reporter';
import type { SessionStorage } from '../../session-storage';
import {
  createSupabaseAuthRepository,
  type SupabaseAuthRepositoryOptions,
} from '../auth-repository';
import { createSupabaseClient } from '../create-supabase-client';

export const PROJECT_URL = 'https://project-ref.supabase.co';
export const AUTH_URL = `${PROJECT_URL}/auth/v1`;
export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const EMAIL = 'reader@example.com';
export const PASSWORD = 'correct-horse-9';
export const CONFIRMATION_URL = 'tsuzuki://auth/callback';
export const PASSWORD_RESET_URL = 'tsuzuki://auth/reset-password';
export const OAUTH_REDIRECT_URL = 'tsuzuki://auth/oauth-callback';
export const ACCESS_TOKEN = 'fake-access-token';
export const REFRESH_TOKEN = 'fake-refresh-token';
// server text echoing personal data, as gotrue messages can
export const SERVER_MESSAGE = `Something failed for ${EMAIL}`;

const ANON_KEY = 'anon-key';
const EXPIRES_IN_S = 3600;
const MS_PER_SECOND = 1000;
const NO_CONTENT = 204;
const API_VERSION_HEADERS = { 'x-supabase-api-version': '2024-01-01' };

export const createUser = (id: string = USER_ID) => ({
  id,
  aud: 'authenticated',
  role: 'authenticated',
  email: EMAIL,
  app_metadata: {},
  user_metadata: {},
  identities: [{ id, user_id: id, provider: 'email' }],
  created_at: '2026-01-01T00:00:00Z',
});

// gotrue's answer to a sign up of an already registered email: a fake user with no identity
export const createObfuscatedUser = () => ({ ...createUser(), identities: [] });

export const createSession = (userId: string = USER_ID) => ({
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: EXPIRES_IN_S,
  expires_at: Math.floor(Date.now() / MS_PER_SECOND) + EXPIRES_IN_S,
  refresh_token: REFRESH_TOKEN,
  user: createUser(userId),
});

/** a gotrue error response with its code and a server message holding the email. */
export const authErrorResponse = (status: number, code: string) =>
  HttpResponse.json({ code, msg: SERVER_MESSAGE }, { status, headers: API_VERSION_HEADERS });

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly search: URLSearchParams;
  readonly body: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  const text = await request.text();
  const body: unknown = text === '' ? {} : JSON.parse(text);
  return isRecord(body) ? body : {};
};

/** every auth request the client sends, in order, with its parsed json body. */
export const createRequestLog = () => {
  const requests: RecordedRequest[] = [];
  const handler = http.all(`${AUTH_URL}/*`, async ({ request }) => {
    const url = new URL(request.url);
    requests.push({
      method: request.method,
      path: url.pathname.replace('/auth/v1', ''),
      search: url.searchParams,
      body: await readBody(request.clone()),
    });
    // falls through to the response handlers
    return undefined;
  });
  return { requests, handler };
};

const grantTypeOf = (request: Request): string | null =>
  new URL(request.url).searchParams.get('grant_type');

/** the successful answer of every auth endpoint the repository calls. */
export const successHandlers = (): HttpHandler[] => [
  http.post(`${AUTH_URL}/signup`, () => HttpResponse.json(createUser())),
  http.post(`${AUTH_URL}/resend`, () => HttpResponse.json({})),
  http.post(`${AUTH_URL}/recover`, () => HttpResponse.json({})),
  http.post(`${AUTH_URL}/token`, () => HttpResponse.json(createSession())),
  http.put(`${AUTH_URL}/user`, () => HttpResponse.json(createUser())),
  http.post(`${AUTH_URL}/logout`, () => new HttpResponse(null, { status: NO_CONTENT })),
];

/** a handler of one endpoint (a token grant type for /token) that answers `respond`. */
export const endpointHandler = (
  endpoint: { method: 'post' | 'put'; path: string; grantType?: string },
  respond: () => Response,
): HttpHandler =>
  http[endpoint.method](`${AUTH_URL}${endpoint.path}`, ({ request }) =>
    endpoint.grantType === undefined || grantTypeOf(request) === endpoint.grantType
      ? respond()
      : undefined,
  );

export const createMemorySessionStorage = () => {
  const values = new Map<string, string>();
  const storage: SessionStorage = {
    getItem: (key) => Promise.resolve(values.get(key) ?? null),
    setItem: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
  return { storage, values };
};

/**
 * a repository over a real client, its session storage and a recording reporter; with the provider
 * sign in setup when given.
 */
export const createTestRepository = (extra: Pick<SupabaseAuthRepositoryOptions, 'oauth'> = {}) => {
  const session = createMemorySessionStorage();
  const client = createSupabaseClient({
    url: PROJECT_URL,
    anonKey: ANON_KEY,
    sessionStorage: session.storage,
  });
  const captureError = jest.fn<ErrorReporter['captureError']>();
  const repository = createSupabaseAuthRepository(client, {
    confirmationRedirectUrl: CONFIRMATION_URL,
    passwordResetRedirectUrl: PASSWORD_RESET_URL,
    reporter: { captureError },
    ...extra,
  });
  return { repository, client, session, captureError };
};

/** the flow id a redirect url carries back (sb_flow_id). */
export const flowIdOf = (redirectTo: string | null): string => {
  const flowId = new URL(redirectTo ?? '').searchParams.get('sb_flow_id');
  if (flowId === null) {
    throw new Error('the redirect carries no flow id');
  }
  return flowId;
};

/** the s256 challenge of a pkce verifier, base64url without padding. */
export const s256 = async (verifier: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
};
