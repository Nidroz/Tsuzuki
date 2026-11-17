import { createHash } from 'node:crypto';

import type { SessionStorage } from '@core/repositories/session-storage';
import { createSupabaseClient } from '@core/repositories/supabase/create-supabase-client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type * as Device from '@platform/__fixtures__/expo-crypto-device';
import {
  expoCrypto,
  nextRandomBytes,
  resetExpoCrypto,
} from '@platform/__fixtures__/expo-crypto-device';
import { installWebCrypto, type WebCryptoTarget } from '@platform/web-crypto';

// proof of the first r-09 finding (docs/security-review.md): on an engine without web crypto, as
// hermes is, the binding of src/platform/web-crypto.ts over expo-crypto makes the real auth-js of
// the app's supabase client send an s256 pkce challenge, its verifier and flow id drawn from the
// secure source, never from Math.random. the control case without the binding sends the plain
// challenge auth-js falls back to: these tests do detect the finding

jest.mock('expo-crypto', () =>
  jest
    .requireActual<typeof Device>('@platform/__fixtures__/expo-crypto-device')
    .fakeExpoCryptoModule(),
);

const PROJECT_URL = 'https://project-ref.supabase.co';
// the default storage key of supabase-js for PROJECT_URL
const STORAGE_KEY = 'sb-project-ref-auth-token';
const ANON_KEY = 'anon-key';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'aaaa@example.com';
const PASSWORD = 'aaaaaaaa';
const CONFIRMATION_URL = 'tsuzuki://auth/callback';
const PASSWORD_RESET_URL = 'tsuzuki://auth/reset-password';
const OAUTH_REDIRECT_URL = 'tsuzuki://auth/oauth-callback';
const FLOW_ID_PARAM = 'sb_flow_id';
const RECOVERY_SUFFIX = '/recovery';

// auth-js 2.117.3 (generatePKCEVerifier, generatePKCEFlowId): the verifier is the low byte of 56
// random 32-bit words in hex, the flow id 16 random bytes in hex; without crypto, each verifier
// character and each flow id digit takes one Math.random call
const VERIFIER_WORDS = 56;
const VERIFIER_BYTES = VERIFIER_WORDS * Uint32Array.BYTES_PER_ELEMENT;
const FLOW_ID_BYTES = 16;
const FLOW_ID_DIGITS = 32;
const VERIFIER_HEX = /^[0-9a-f]{112}$/;
const FLOW_ID_HEX = /^[0-9a-f]{32}$/;
// generatePKCEChallenge's warning when it falls back to the plain method
const NO_WEB_CRYPTO_WARNING = 'WebCrypto API is not supported';
// what Math.random returns here: no real randomness, even on the fallback path
const FIXED_RANDOM = 0.5;
const BYTE_VALUES = 256;
const OK = 200;

// the test environment's own crypto (node): hermes has none, so each test removes it
const nativeCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

const restoreNativeCrypto = () => {
  if (nativeCrypto) {
    Object.defineProperty(globalThis, 'crypto', nativeCrypto);
  } else {
    Reflect.deleteProperty(globalThis, 'crypto');
  }
};

// gives globalThis the crypto the installer defines on a global without one (web-crypto.test.ts,
// web-crypto-polyfill.test.ts). it is made on a bare target, then defined on globalThis: the
// installer acts once per target, and a fresh module registry (jest.isolateModules) would evaluate
// expo again, whose runtime replaces the setup's network stub with a lazy fetch of its own
const installBinding = (): void => {
  const target: WebCryptoTarget = {};
  expect(installWebCrypto(target)).toStrictEqual(['crypto']);
  Object.defineProperty(globalThis, 'crypto', {
    value: target.crypto,
    writable: true,
    enumerable: true,
    configurable: true,
  });
};

// the two signs of the fallback: a Math.random call, and the warning of generatePKCEChallenge
const watchFallbacks = () => ({
  random: jest.spyOn(Math, 'random').mockReturnValue(FIXED_RANDOM),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => undefined),
});

const hexByte = (value: number): string => (value % BYTE_VALUES).toString(16).padStart(2, '0');

// the verifier and the flow id auth-js makes of the bytes the fake source hands out next
const expectedPkceIds = () => {
  const bytes = nextRandomBytes(VERIFIER_BYTES + FLOW_ID_BYTES);
  const words = new Uint32Array(bytes.buffer, 0, VERIFIER_WORDS);
  return {
    verifier: Array.from(words, (word) => hexByte(word)).join(''),
    flowId: Array.from(bytes.subarray(VERIFIER_BYTES), (byte) => hexByte(byte)).join(''),
  };
};

// the s256 challenge of a verifier (rfc 7636): base64url of its sha-256 without padding, by node
const s256 = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

interface CapturedRequest {
  readonly path: string;
  readonly redirectTo: string | null;
  readonly body: unknown;
}

const urlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
};

// every request the client sends, answered with `answer` as json: nothing leaves the test
const captureRequests = (answer: unknown): CapturedRequest[] => {
  const requests: CapturedRequest[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(urlOf(input));
    requests.push({
      path: url.pathname,
      redirectTo: url.searchParams.get('redirect_to'),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(answer), {
        status: OK,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  return requests;
};

// the app's client over an in-memory session storage
const createClient = () => {
  const values = new Map<string, string>();
  const sessionStorage: SessionStorage = {
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
  const client = createSupabaseClient({ url: PROJECT_URL, anonKey: ANON_KEY, sessionStorage });
  return { client, values };
};

const flowIdOf = (redirectTo: string | null | undefined): string =>
  new URL(redirectTo ?? '').searchParams.get(FLOW_ID_PARAM) ?? '';

// the verifier auth-js stored in the slot of a flow (appendPkceFlowIdToRedirects), json decoded
const storedVerifier = (values: ReadonlyMap<string, string>, flowId: string): string => {
  const stored = values.get(`${STORAGE_KEY}-flow-${flowId}-code-verifier`);
  const verifier: unknown = stored === undefined ? undefined : JSON.parse(stored);
  if (typeof verifier !== 'string') throw new Error(`no verifier stored for the flow ${flowId}`);
  return verifier;
};

const signUp = (client: ReturnType<typeof createClient>['client']) =>
  client.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { emailRedirectTo: CONFIRMATION_URL },
  });

const SIGN_UP_ANSWER = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: EMAIL };

// every test runs on an engine without crypto, as hermes is, with a fresh fake source
beforeEach(() => {
  resetExpoCrypto();
  Reflect.deleteProperty(globalThis, 'crypto');
});
afterEach(restoreNativeCrypto);

describe('supabase pkce with the web crypto binding on an engine without crypto', () => {
  let fallbacks: ReturnType<typeof watchFallbacks>;

  beforeEach(() => {
    installBinding();
    fallbacks = watchFallbacks();
  });

  it('sends a sign up with the s256 challenge of the verifier it stored', async () => {
    const { client, values } = createClient();
    const requests = captureRequests(SIGN_UP_ANSWER);

    await expect(signUp(client)).resolves.toMatchObject({ error: null });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    const verifier = storedVerifier(values, flowIdOf(request?.redirectTo));
    expect(request).toMatchObject({
      path: '/auth/v1/signup',
      body: { code_challenge_method: 's256', code_challenge: s256(verifier) },
    });
    expect(fallbacks.random).not.toHaveBeenCalled();
    expect(fallbacks.warn).not.toHaveBeenCalled();
  });

  it('draws the verifier and the flow id from expo-crypto and hashes through it', async () => {
    const expected = expectedPkceIds();
    const { client, values } = createClient();
    const requests = captureRequests(SIGN_UP_ANSWER);

    await signUp(client);

    const flowId = flowIdOf(requests[0]?.redirectTo);
    expect(flowId).toMatch(FLOW_ID_HEX);
    expect(flowId).toBe(expected.flowId);
    expect(storedVerifier(values, flowId)).toMatch(VERIFIER_HEX);
    expect(storedVerifier(values, flowId)).toBe(expected.verifier);
    expect(expoCrypto.calls).toStrictEqual([
      `random:${String(VERIFIER_BYTES)}`,
      `random:${String(FLOW_ID_BYTES)}`,
      `digest:SHA-256:${String(expected.verifier.length)}`,
    ]);
    expect(fallbacks.random).not.toHaveBeenCalled();
  });

  it('sends a password reset with the s256 challenge of its recovery verifier', async () => {
    const { client, values } = createClient();
    const requests = captureRequests({});

    await expect(
      client.auth.resetPasswordForEmail(EMAIL, { redirectTo: PASSWORD_RESET_URL }),
    ).resolves.toMatchObject({ error: null });

    const [request] = requests;
    const stored = storedVerifier(values, flowIdOf(request?.redirectTo));
    expect(stored.endsWith(RECOVERY_SUFFIX)).toBe(true);
    const verifier = stored.slice(0, -RECOVERY_SUFFIX.length);
    expect(verifier).toMatch(VERIFIER_HEX);
    expect(request).toMatchObject({
      path: '/auth/v1/recover',
      body: { code_challenge_method: 's256', code_challenge: s256(verifier) },
    });
    expect(fallbacks.random).not.toHaveBeenCalled();
    expect(fallbacks.warn).not.toHaveBeenCalled();
  });

  it('puts the s256 challenge in the provider authorize url, sending nothing', async () => {
    const { client, values } = createClient();
    const requests = captureRequests({});

    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
    });

    expect(error).toBeNull();
    const params = new URL(data.url ?? '').searchParams;
    const verifier = storedVerifier(values, flowIdOf(params.get('redirect_to')));
    expect(params.get('code_challenge_method')).toBe('s256');
    expect(params.get('code_challenge')).toBe(s256(verifier));
    expect(requests).toStrictEqual([]);
    expect(fallbacks.random).not.toHaveBeenCalled();
    expect(fallbacks.warn).not.toHaveBeenCalled();
  });
});

describe('supabase pkce on an engine without crypto and without the binding', () => {
  it('sends the verifier as a plain challenge, drawn from Math.random (the finding)', async () => {
    const fallbacks = watchFallbacks();
    const { client, values } = createClient();
    const requests = captureRequests(SIGN_UP_ANSWER);

    await expect(signUp(client)).resolves.toMatchObject({ error: null });

    const [request] = requests;
    const verifier = storedVerifier(values, flowIdOf(request?.redirectTo));
    expect(request?.body).toMatchObject({
      code_challenge_method: 'plain',
      code_challenge: verifier,
    });
    expect(fallbacks.random).toHaveBeenCalledTimes(VERIFIER_WORDS + FLOW_ID_DIGITS);
    expect(fallbacks.warn).toHaveBeenCalledWith(expect.stringContaining(NO_WEB_CRYPTO_WARNING));
    expect(expoCrypto.calls).toStrictEqual([]);
  });
});
