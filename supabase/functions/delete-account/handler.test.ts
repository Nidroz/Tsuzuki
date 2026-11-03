import { describe, expect, it } from '@jest/globals';

import {
  createDeleteAccountHandler,
  readDeleteAccountEnv,
  toDeletionOutcome,
  toVerifiedUser,
  type DeleteAccountPorts,
  type DeletionOutcome,
  type VerifiedUser,
} from './handler';

const ENDPOINT = 'https://project.test/functions/v1/delete-account';
const TOKEN = 'aaa.bbb.ccc';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const SECRET = 'test-service-role-placeholder';
const MAX_TOKEN_LENGTH = 8192;
// a valid token shape of the given length in all
const tokenOfLength = (length: number) => `aaa.bbb.${'c'.repeat(length - 'aaa.bbb.'.length)}`;

const DELETED = '{"deleted":true}';
const METHOD_NOT_ALLOWED = '{"error":"method-not-allowed"}';
const SERVER_MISCONFIGURED = '{"error":"server-misconfigured"}';
const UNAUTHORIZED = '{"error":"unauthorized"}';
const UNAVAILABLE = '{"error":"unavailable"}';
const DELETION_FAILED = '{"error":"deletion-failed"}';

const VERIFIED: VerifiedUser = { status: 'verified', userId: USER_ID };

// fake ports recording their calls; an Error is thrown by the port
const fakePorts = (
  verified: VerifiedUser | Error = VERIFIED,
  deletion: DeletionOutcome | Error = 'deleted',
) => {
  const verifyCalls: string[] = [];
  const deleteCalls: string[] = [];
  const ports: DeleteAccountPorts = {
    verifyUser: (token) => {
      verifyCalls.push(token);
      return verified instanceof Error ? Promise.reject(verified) : Promise.resolve(verified);
    },
    deleteUser: (userId) => {
      deleteCalls.push(userId);
      return deletion instanceof Error ? Promise.reject(deletion) : Promise.resolve(deletion);
    },
  };
  return { ports, verifyCalls, deleteCalls };
};

const post = (authorization: string | null = `Bearer ${TOKEN}`, init: RequestInit = {}) =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: authorization === null ? {} : { Authorization: authorization },
    ...init,
  });

// status, exact body and every header name, so a cors header would show
const read = async (response: Response) => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  return { status: response.status, body: await response.text(), headers };
};

const FIXED_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const answer = (status: number, body: string) => ({ status, body, headers: FIXED_HEADERS });

describe('createDeleteAccountHandler', () => {
  it.each(['GET', 'PUT', 'DELETE', 'OPTIONS'])(
    'answers %s 405 without a port call',
    async (method) => {
      const { ports, verifyCalls, deleteCalls } = fakePorts();
      const response = await createDeleteAccountHandler(ports)(
        new Request(ENDPOINT, { method, headers: { Authorization: `Bearer ${TOKEN}` } }),
      );

      expect(await read(response)).toStrictEqual({
        status: 405,
        body: METHOD_NOT_ALLOWED,
        headers: { ...FIXED_HEADERS, allow: 'POST' },
      });
      expect([verifyCalls, deleteCalls]).toStrictEqual([[], []]);
    },
  );

  it('answers 500 when the env is missing, after the method check', async () => {
    const handler = createDeleteAccountHandler(null);

    expect(await read(await handler(post()))).toStrictEqual(answer(500, SERVER_MISCONFIGURED));
    expect((await handler(new Request(ENDPOINT))).status).toBe(405);
  });

  it.each([
    ['no header', null],
    ['the basic scheme', `Basic ${TOKEN}`],
    ['a lowercase scheme', `bearer ${TOKEN}`],
    ['a missing token', 'Bearer'],
    ['two segments', 'Bearer aaa.bbb'],
    ['four segments', 'Bearer aaa.bbb.ccc.ddd'],
    ['a token over the bound', `Bearer ${tokenOfLength(MAX_TOKEN_LENGTH + 1)}`],
  ])('answers 401 to %s without a port call', async (_case, authorization) => {
    const { ports, verifyCalls, deleteCalls } = fakePorts();
    const response = await createDeleteAccountHandler(ports)(post(authorization));

    expect(await read(response)).toStrictEqual(answer(401, UNAUTHORIZED));
    expect([verifyCalls, deleteCalls]).toStrictEqual([[], []]);
  });

  it('verifies a token at the bound', async () => {
    const token = tokenOfLength(MAX_TOKEN_LENGTH);
    const { ports, verifyCalls } = fakePorts();
    const response = await createDeleteAccountHandler(ports)(post(`Bearer ${token}`));

    expect(response.status).toBe(200);
    expect(verifyCalls).toStrictEqual([token]);
  });

  it('answers 401 to a token the auth server refuses and never deletes', async () => {
    const { ports, verifyCalls, deleteCalls } = fakePorts({ status: 'refused' });
    const response = await createDeleteAccountHandler(ports)(post());

    expect(await read(response)).toStrictEqual(answer(401, UNAUTHORIZED));
    expect([verifyCalls, deleteCalls]).toStrictEqual([[TOKEN], []]);
  });

  it.each([
    ['answers unavailable', { status: 'unavailable' } as const],
    ['throws', new Error(`auth down, key ${SECRET}`)],
  ])('answers 503 when the auth server %s and never deletes', async (_case, verified) => {
    const { ports, deleteCalls } = fakePorts(verified);
    const response = await createDeleteAccountHandler(ports)(post());

    expect(await read(response)).toStrictEqual(answer(503, UNAVAILABLE));
    expect(deleteCalls).toStrictEqual([]);
  });

  it.each(['not-a-uuid', '', `${USER_ID}0`])(
    'answers 500 to a verified id %p that is not a uuid, never deleting',
    async (userId) => {
      const { ports, deleteCalls } = fakePorts({ status: 'verified', userId });
      const response = await createDeleteAccountHandler(ports)(post());

      expect(await read(response)).toStrictEqual(answer(500, DELETION_FAILED));
      expect(deleteCalls).toStrictEqual([]);
    },
  );

  it('deletes only the verified user, once, whatever the body and the query name', async () => {
    const { ports, verifyCalls, deleteCalls } = fakePorts();
    const request = new Request(`${ENDPOINT}?user_id=${OTHER_USER_ID}&id=${OTHER_USER_ID}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: OTHER_USER_ID, userId: OTHER_USER_ID }),
    });
    const response = await createDeleteAccountHandler(ports)(request);

    expect(await read(response)).toStrictEqual(answer(200, DELETED));
    expect([verifyCalls, deleteCalls]).toStrictEqual([[TOKEN], [USER_ID]]);
    expect(request.bodyUsed).toBe(false);
  });

  it('answers 200 when the user is already gone', async () => {
    const { ports, deleteCalls } = fakePorts(VERIFIED, 'not-found');
    const response = await createDeleteAccountHandler(ports)(post());

    expect(await read(response)).toStrictEqual(answer(200, DELETED));
    expect(deleteCalls).toStrictEqual([USER_ID]);
  });

  it.each([
    ['fails', 'failed' as const],
    ['throws', new Error(`delete failed for user@example.test, key ${SECRET}, token ${TOKEN}`)],
  ])('answers 500 with the fixed body when the deletion %s', async (_case, deletion) => {
    const { ports } = fakePorts(VERIFIED, deletion);
    const response = await read(await createDeleteAccountHandler(ports)(post()));

    expect(response).toStrictEqual(answer(500, DELETION_FAILED));
    for (const leak of ['user@example.test', SECRET, TOKEN, USER_ID, 'delete failed']) {
      expect(response.body).not.toContain(leak);
    }
  });
});

describe('readDeleteAccountEnv', () => {
  const ENV = { SUPABASE_URL: 'http://kong.test:8000', SUPABASE_SERVICE_ROLE_KEY: SECRET };

  it('reads the url and the service role key', () => {
    const values: Record<string, string> = ENV;
    const names: string[] = [];
    const env = readDeleteAccountEnv((name) => {
      names.push(name);
      return values[name];
    });

    expect(env).toStrictEqual({ url: ENV.SUPABASE_URL, serviceRoleKey: SECRET });
    expect(names).toStrictEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
  });

  it.each([
    ['the url missing', { SUPABASE_SERVICE_ROLE_KEY: SECRET }],
    ['the key missing', { SUPABASE_URL: ENV.SUPABASE_URL }],
    ['the key empty', { ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' }],
    ['the url blank', { ...ENV, SUPABASE_URL: '  ' }],
  ])('answers null with %s', (_case, values: Record<string, string>) => {
    expect(readDeleteAccountEnv((name) => values[name])).toBeNull();
  });
});

describe('toVerifiedUser', () => {
  it('verifies the user the auth server returned', () => {
    expect(toVerifiedUser({ data: { user: { id: USER_ID } }, error: null })).toStrictEqual(
      VERIFIED,
    );
  });

  it('refuses an answer without a user', () => {
    expect(toVerifiedUser({ data: { user: null }, error: null })).toStrictEqual({
      status: 'refused',
    });
  });

  // bad or expired jwt, session or user gone
  it.each([400, 401, 403, 404])('refuses an auth error with status %p', (status) => {
    expect(toVerifiedUser({ data: { user: null }, error: { status } })).toStrictEqual({
      status: 'refused',
    });
  });

  // no answer (0), an unknown error (no status), a server error, a timeout, a rate limit
  it.each([0, undefined, 408, 429, 500, 503])('is unavailable on status %p', (status) => {
    expect(toVerifiedUser({ data: { user: null }, error: { status } })).toStrictEqual({
      status: 'unavailable',
    });
  });
});

describe('toDeletionOutcome', () => {
  it('reads no error as deleted', () => {
    expect(toDeletionOutcome({ error: null })).toBe('deleted');
  });

  it.each([{ status: 404, code: 'user_not_found' }, { status: 404 }, { code: 'user_not_found' }])(
    'reads %p as not found',
    (error) => {
      expect(toDeletionOutcome({ error })).toBe('not-found');
    },
  );

  it.each([{ status: 0 }, { status: 403, code: 'not_admin' }, { status: 500 }, {}])(
    'reads %p as failed',
    (error) => {
      expect(toDeletionOutcome({ error })).toBe('failed');
    },
  );
});
