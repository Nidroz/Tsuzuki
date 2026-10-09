import { describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { SessionStorage } from '../session-storage';
import { createSupabaseClient } from './create-supabase-client';

const PROJECT_URL = 'https://project-ref.supabase.co';
const ANON_KEY = 'anon-key';
const ACCESS_TOKEN = 'fake-access-token';
const EXPIRES_IN_S = 3600;
const MS_PER_SECOND = 1000;
const BAD_REQUEST = 400;

const createSessionStorageSpy = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn<SessionStorage['getItem']>((key) => Promise.resolve(values.get(key) ?? null)),
    setItem: jest.fn<SessionStorage['setItem']>((key, value) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn<SessionStorage['removeItem']>((key) => {
      values.delete(key);
      return Promise.resolve();
    }),
  };
};

const createFakeSession = () => ({
  access_token: ACCESS_TOKEN,
  token_type: 'bearer',
  expires_in: EXPIRES_IN_S,
  expires_at: Math.floor(Date.now() / MS_PER_SECOND) + EXPIRES_IN_S,
  refresh_token: 'fake-refresh-token',
  user: {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
});

describe('createSupabaseClient', () => {
  it('creates a client exposing auth and the database', () => {
    const client = createSupabaseClient({
      url: PROJECT_URL,
      anonKey: ANON_KEY,
      sessionStorage: createSessionStorageSpy(),
    });
    expect(typeof client.auth.signInWithPassword).toBe('function');
    expect(typeof client.from).toBe('function');
  });

  it('stores the session only through the session storage', async () => {
    server.use(
      http.post(`${PROJECT_URL}/auth/v1/token`, ({ request }) =>
        new URL(request.url).searchParams.get('grant_type') === 'password'
          ? HttpResponse.json(createFakeSession())
          : HttpResponse.json({}, { status: BAD_REQUEST }),
      ),
    );
    const sessionStorage = createSessionStorageSpy();
    const client = createSupabaseClient({ url: PROJECT_URL, anonKey: ANON_KEY, sessionStorage });

    const { data, error } = await client.auth.signInWithPassword({
      email: 'reader@example.com',
      password: 'password',
    });

    expect(error).toBeNull();
    expect(data.session?.access_token).toBe(ACCESS_TOKEN);
    expect(sessionStorage.setItem).toHaveBeenCalled();
    expect([...sessionStorage.values.values()].join()).toContain(ACCESS_TOKEN);
    expect(globalThis).not.toHaveProperty('localStorage');
  });
});
