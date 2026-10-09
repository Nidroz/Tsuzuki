import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { QueryClient } from '@tanstack/react-query';
import { persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import {
  PERSIST_THROTTLE_MS,
  QUERY_CACHE_STORAGE_KEY,
  createPersistOptions,
  createQueryPersister,
} from '../../query/persister';
import { createQueryClient } from '../../query/query-client';
import type { SessionStorage } from '../session-storage';
import type { StorageAdapter } from '../storage-adapter';
import { createSupabaseClient } from './create-supabase-client';

// acceptance proof: the auth session reaches the session storage (secure store on mobile) and
// never the synchronous storage (MMKV on mobile), not even through the persisted query cache

const PROJECT_URL = 'https://project-ref.supabase.co';
const ANON_KEY = 'anon-key';
const APP_VERSION = '1.0.0';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const FIRST_TOKENS = { access: 'first-access-token', refresh: 'first-refresh-token' };
const ROTATED_TOKENS = { access: 'rotated-access-token', refresh: 'rotated-refresh-token' };
const EXPIRES_IN_S = 3600;
const MS_PER_SECOND = 1000;
const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const NO_CONTENT = 204;
const PROFILE_KEY = ['profile', USER_ID];
const PROFILE_ROW = {
  id: USER_ID,
  preferences: { contentFilter: 'safe' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

interface Tokens {
  access: string;
  refresh: string;
}

type StorageWrite = { op: 'set'; key: string; value: string } | { op: 'delete'; key: string };

const createRecordingStorage = () => {
  const values = new Map<string, string>();
  const writes: StorageWrite[] = [];
  const storage: StorageAdapter = {
    getString: (key) => values.get(key),
    set: (key, value) => {
      writes.push({ op: 'set', key, value });
      values.set(key, value);
    },
    delete: (key) => {
      writes.push({ op: 'delete', key });
      values.delete(key);
    },
  };
  return { storage, values, writes };
};

const createMemorySessionStorage = () => {
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

const createSession = ({ access, refresh }: Tokens) => ({
  access_token: access,
  token_type: 'bearer',
  expires_in: EXPIRES_IN_S,
  expires_at: Math.floor(Date.now() / MS_PER_SECOND) + EXPIRES_IN_S,
  refresh_token: refresh,
  user: {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  },
});

const tokenHandler = http.post(`${PROJECT_URL}/auth/v1/token`, async ({ request }) => {
  const grantType = new URL(request.url).searchParams.get('grant_type');
  if (grantType === 'password') {
    return HttpResponse.json(createSession(FIRST_TOKENS));
  }
  const body: unknown = await request.json();
  const isFirstRefresh =
    grantType === 'refresh_token' &&
    typeof body === 'object' &&
    body !== null &&
    'refresh_token' in body &&
    body.refresh_token === FIRST_TOKENS.refresh;
  return isFirstRefresh
    ? HttpResponse.json(createSession(ROTATED_TOKENS))
    : HttpResponse.json({}, { status: BAD_REQUEST });
});

// the profile row is served only to the signed-in user: proves the query ran with the session
const profileHandler = http.get(`${PROJECT_URL}/rest/v1/profiles`, ({ request }) =>
  request.headers.get('authorization') === `Bearer ${FIRST_TOKENS.access}`
    ? HttpResponse.json(PROFILE_ROW)
    : HttpResponse.json({}, { status: UNAUTHORIZED }),
);

const logoutHandler = http.post(
  `${PROJECT_URL}/auth/v1/logout`,
  () => new HttpResponse(null, { status: NO_CONTENT }),
);

const ALL_TOKENS = [
  FIRST_TOKENS.access,
  FIRST_TOKENS.refresh,
  ROTATED_TOKENS.access,
  ROTATED_TOKENS.refresh,
];

const leakedTokens = (writes: StorageWrite[]): string[] => {
  const written = writes.map((write) => JSON.stringify(write)).join('\n');
  return ALL_TOKENS.filter((token) => written.includes(token));
};

const sessionText = (values: Map<string, string>): string => [...values.values()].join('\n');

describe('auth session isolation', () => {
  let queryClient: QueryClient;
  let unsubscribe: () => void;
  let mmkv: ReturnType<typeof createRecordingStorage>;
  let session: ReturnType<typeof createMemorySessionStorage>;
  let supabase: ReturnType<typeof createSupabaseClient>;

  const fetchProfile = () =>
    queryClient.query({
      queryKey: PROFILE_KEY,
      queryFn: async () => {
        const { data, error } = await supabase.from('profiles').select().eq('id', USER_ID).single();
        if (error !== null) {
          throw new Error(error.message);
        }
        return data;
      },
    });

  const signIn = () =>
    supabase.auth.signInWithPassword({ email: 'reader@example.com', password: 'password' });

  const flushPersistence = () => {
    jest.advanceTimersByTime(PERSIST_THROTTLE_MS);
  };

  beforeEach(() => {
    server.use(tokenHandler, profileHandler, logoutHandler);
    mmkv = createRecordingStorage();
    session = createMemorySessionStorage();
    supabase = createSupabaseClient({
      url: PROJECT_URL,
      anonKey: ANON_KEY,
      sessionStorage: session.storage,
    });
    queryClient = createQueryClient();
    const options = createPersistOptions({
      persister: createQueryPersister(mmkv.storage),
      appVersion: APP_VERSION,
    });
    unsubscribe = persistQueryClientSubscribe({ ...options, queryClient });
  });

  afterEach(() => {
    unsubscribe();
    queryClient.clear();
  });

  it('stores the signed-in tokens only in the session storage', async () => {
    const { error } = await signIn();

    expect(error).toBeNull();
    const stored = sessionText(session.values);
    expect(stored).toContain(FIRST_TOKENS.access);
    expect(stored).toContain(FIRST_TOKENS.refresh);
    expect(mmkv.writes).toEqual([]);
  });

  it('persists an authenticated query to the storage without the tokens', async () => {
    await signIn();

    await expect(fetchProfile()).resolves.toEqual(PROFILE_ROW);
    flushPersistence();

    // the cache was written: the check below inspects a real write, not an empty log
    expect(mmkv.values.get(QUERY_CACHE_STORAGE_KEY)).toContain(USER_ID);
    expect(mmkv.writes.every((write) => write.key === QUERY_CACHE_STORAGE_KEY)).toBe(true);
    expect(leakedTokens(mmkv.writes)).toEqual([]);
  });

  it('stores the rotated tokens only in the session storage after a refresh', async () => {
    await signIn();
    await fetchProfile();

    const { error } = await supabase.auth.refreshSession();
    flushPersistence();

    expect(error).toBeNull();
    const stored = sessionText(session.values);
    expect(stored).toContain(ROTATED_TOKENS.access);
    expect(stored).toContain(ROTATED_TOKENS.refresh);
    expect(stored).not.toContain(FIRST_TOKENS.access);
    expect(leakedTokens(mmkv.writes)).toEqual([]);
  });

  it('removes the session from the session storage on sign-out without touching the storage', async () => {
    await signIn();

    const { error } = await supabase.auth.signOut();

    expect(error).toBeNull();
    expect(sessionText(session.values)).not.toContain(FIRST_TOKENS.access);
    expect(sessionText(session.values)).not.toContain(FIRST_TOKENS.refresh);
    expect(mmkv.writes).toEqual([]);
  });

  it('restores the session in a new client from the session storage alone', async () => {
    await signIn();
    const restarted = createSupabaseClient({
      url: PROJECT_URL,
      anonKey: ANON_KEY,
      sessionStorage: session.storage,
    });

    const { data } = await restarted.auth.getSession();

    expect(data.session?.access_token).toBe(FIRST_TOKENS.access);
    expect(mmkv.writes).toEqual([]);
  });
});
