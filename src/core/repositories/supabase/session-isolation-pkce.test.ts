import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { http, HttpResponse } from 'msw';

import { server } from '../../../../test/core/msw-server';
import type { OAuthBrowser } from '../auth-repository';
import {
  AUTH_URL,
  EMAIL,
  OAUTH_REDIRECT_URL,
  PASSWORD,
  createRequestLog,
  createTestRepository,
  flowIdOf,
  successHandlers,
} from './__fixtures__/auth-handlers';

// acceptance proof (ADR-0018, docs/ARCHITECTURE.md §8): the sign out leaves no session and no pkce
// verifier in the session storage (secure store on mobile), whatever flows were left pending. it
// pins the supabase-js teardown: the session key, every flow slot of appendPkceFlowIdToRedirects,
// their index and the legacy `-code-verifier` key

// the default storage key of supabase-js for https://project-ref.supabase.co
const STORAGE_KEY = 'sb-project-ref-auth-token';
const FLOW_INDEX_KEY = `${STORAGE_KEY}-flows-code-verifier`;
const LEGACY_VERIFIER_KEY = `${STORAGE_KEY}-code-verifier`;
// one more than the pending flows supabase-js keeps (PKCE_MAX_CONCURRENT_FLOWS)
const FLOWS_PAST_THE_LIMIT = 6;

const flowSlotKey = (flowId: string): string => `${STORAGE_KEY}-flow-${flowId}-code-verifier`;

describe('auth session isolation: pkce verifiers at sign out', () => {
  let log: ReturnType<typeof createRequestLog>;
  let context: ReturnType<typeof createTestRepository>;
  let openAuthSession: jest.Mock<OAuthBrowser['openAuthSession']>;

  const storedKeys = (): string[] => [...context.session.values.keys()].sort();

  // the flow ids of the password resets requested so far, from the redirect each one sent
  const recoveryFlowIds = (): string[] =>
    log.requests
      .filter((request) => request.path === '/recover')
      .map((request) => flowIdOf(request.search.get('redirect_to')));

  // the flow id of the abandoned provider sign in, from the authorize url the browser opened
  const oauthFlowId = (): string => {
    const [url] = openAuthSession.mock.calls[0] ?? [];
    return flowIdOf(new URL(url ?? '').searchParams.get('redirect_to'));
  };

  // a provider sign in closed in the browser, then a password reset request: two pending flows
  const leaveTwoFlowsPending = async () => {
    await expect(context.repository.signInWithProvider('google')).resolves.toBeNull();
    await context.repository.requestPasswordReset(EMAIL);
    return [oauthFlowId(), ...recoveryFlowIds()];
  };

  const signIn = () => context.repository.signIn({ email: EMAIL, password: PASSWORD });

  beforeEach(() => {
    log = createRequestLog();
    server.use(log.handler, ...successHandlers());
    openAuthSession = jest.fn<OAuthBrowser['openAuthSession']>(() =>
      Promise.resolve({ type: 'closed' }),
    );
    context = createTestRepository({
      oauth: {
        browser: { openAuthSession },
        providers: ['google'],
        redirectUrl: OAUTH_REDIRECT_URL,
      },
    });
  });

  it('removes the session and every pending verifier at sign out', async () => {
    const flowIds = await leaveTwoFlowsPending();
    await signIn();

    // the sign in keeps the pending verifiers: the sign out is what removes them
    expect(flowIds).toHaveLength(2);
    expect(storedKeys()).toEqual(
      [STORAGE_KEY, FLOW_INDEX_KEY, LEGACY_VERIFIER_KEY, ...flowIds.map(flowSlotKey)].sort(),
    );

    await expect(context.repository.signOut()).resolves.toBeUndefined();

    expect(storedKeys()).toEqual([]);
  });

  it('removes every pending verifier when the server cannot revoke the session', async () => {
    await leaveTwoFlowsPending();
    await signIn();
    server.use(http.post(`${AUTH_URL}/logout`, () => HttpResponse.error()));

    await expect(context.repository.signOut()).resolves.toBeUndefined();

    expect(storedKeys()).toEqual([]);
  });

  it('removes every verifier when more flows were started than supabase-js keeps', async () => {
    for (let flow = 0; flow < FLOWS_PAST_THE_LIMIT; flow += 1) {
      await context.repository.requestPasswordReset(EMAIL);
    }
    await signIn();
    const [evicted, ...kept] = recoveryFlowIds();

    // the oldest slot was evicted when the sixth flow started; the others wait for the sign out
    expect(kept).toHaveLength(FLOWS_PAST_THE_LIMIT - 1);
    expect(storedKeys()).not.toContain(flowSlotKey(evicted ?? ''));
    expect(storedKeys()).toEqual(expect.arrayContaining(kept.map(flowSlotKey)));

    await expect(context.repository.signOut()).resolves.toBeUndefined();

    expect(storedKeys()).toEqual([]);
  });
});
