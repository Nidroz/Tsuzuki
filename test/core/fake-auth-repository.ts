// a test double of the auth repository (src/core/repositories/auth-repository.ts), for tests of the
// auth hooks, screens and the composition root: no supabase, no network, no timer
import { jest } from '@jest/globals';

import type {
  AuthRepository,
  AuthSession,
  AuthSessionListener,
  UserGoneListener,
} from '@core/repositories/auth-repository';

/** the rejection (or throw) of a fake method the test did not set up */
export const unexpectedAuthCallMessage = (method: keyof AuthRepository): string =>
  `unexpected call to the fake auth repository: ${method}`;

const rejectUnexpected = (method: keyof AuthRepository) => (): Promise<never> =>
  Promise.reject(new Error(unexpectedAuthCallMessage(method)));

const throwUnexpected = (method: keyof AuthRepository) => (): never => {
  throw new Error(unexpectedAuthCallMessage(method));
};

// subscribed in every tree (DevicePurgeContextProvider), and passive: nothing is reported
const neverReportsUserGone: AuthRepository['onUserGone'] = () => () => undefined;

/**
 * a repository whose methods run the given `overrides`, every other method rejecting (or, for the
 * synchronous onAuthStateChange and setAutoRefresh, throwing) with an error naming it: a test
 * states the calls it expects. onUserGone subscribes and never reports unless overridden
 * (createUserGoneSource). the methods stay jest mocks
 */
export const createFakeAuthRepository = (overrides: Partial<AuthRepository> = {}) =>
  ({
    signUp: jest.fn<AuthRepository['signUp']>(overrides.signUp ?? rejectUnexpected('signUp')),
    resendConfirmation: jest.fn<AuthRepository['resendConfirmation']>(
      overrides.resendConfirmation ?? rejectUnexpected('resendConfirmation'),
    ),
    signIn: jest.fn<AuthRepository['signIn']>(overrides.signIn ?? rejectUnexpected('signIn')),
    requestPasswordReset: jest.fn<AuthRepository['requestPasswordReset']>(
      overrides.requestPasswordReset ?? rejectUnexpected('requestPasswordReset'),
    ),
    completeEmailLink: jest.fn<AuthRepository['completeEmailLink']>(
      overrides.completeEmailLink ?? rejectUnexpected('completeEmailLink'),
    ),
    updatePassword: jest.fn<AuthRepository['updatePassword']>(
      overrides.updatePassword ?? rejectUnexpected('updatePassword'),
    ),
    signOut: jest.fn<AuthRepository['signOut']>(overrides.signOut ?? rejectUnexpected('signOut')),
    deleteAccount: jest.fn<AuthRepository['deleteAccount']>(
      overrides.deleteAccount ?? rejectUnexpected('deleteAccount'),
    ),
    onAuthStateChange: jest.fn<AuthRepository['onAuthStateChange']>(
      overrides.onAuthStateChange ?? throwUnexpected('onAuthStateChange'),
    ),
    setAutoRefresh: jest.fn<AuthRepository['setAutoRefresh']>(
      overrides.setAutoRefresh ?? throwUnexpected('setAutoRefresh'),
    ),
    onUserGone: jest.fn<AuthRepository['onUserGone']>(overrides.onUserGone ?? neverReportsUserGone),
    // no provider unless the test gives some: the provider buttons stay hidden
    oauthProviders: overrides.oauthProviders ?? [],
    signInWithProvider: jest.fn<AuthRepository['signInWithProvider']>(
      overrides.signInWithProvider ?? rejectUnexpected('signInWithProvider'),
    ),
  }) satisfies AuthRepository;

export type FakeAuthRepository = ReturnType<typeof createFakeAuthRepository>;

/**
 * a session the test drives, for the onAuthStateChange override: like the real repository, a new
 * listener gets the current session asynchronously (a microtask), then every `emit`
 */
export const createSessionSource = (initial: AuthSession | null) => {
  let current = initial;
  const listeners = new Set<AuthSessionListener>();
  return {
    subscribe: (listener: AuthSessionListener): (() => void) => {
      listeners.add(listener);
      void Promise.resolve().then(() => {
        if (listeners.has(listener)) {
          listener(current);
        }
      });
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (session: AuthSession | null): void => {
      current = session;
      for (const listener of listeners) {
        listener(session);
      }
    },
    listenerCount: (): number => listeners.size,
  };
};

export type SessionSource = ReturnType<typeof createSessionSource>;

/**
 * the users gone a test reports, for the onUserGone override: `report(userId)` calls every
 * listener synchronously, in subscription order, as the real repository does
 */
export const createUserGoneSource = () => {
  const listeners = new Set<UserGoneListener>();
  return {
    subscribe: (listener: UserGoneListener): (() => void) => {
      const entry: UserGoneListener = (userId) => {
        listener(userId);
      };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    report: (userId: string): void => {
      for (const listener of [...listeners]) {
        listener(userId);
      }
    },
    listenerCount: (): number => listeners.size,
  };
};

export type UserGoneSource = ReturnType<typeof createUserGoneSource>;

const ignoreAutoRefresh: AuthRepository['setAutoRefresh'] = () => undefined;

/**
 * createFakeAuthRepository reporting `session` (signed out by default) and accepting the auto
 * refresh toggle: the default of the screens and the composition root, whose other calls reject
 * until the test sets them up
 */
export const createSessionAuthRepository = (
  session: AuthSession | null = null,
  overrides: Partial<AuthRepository> = {},
) =>
  createFakeAuthRepository({
    onAuthStateChange: createSessionSource(session).subscribe,
    setAutoRefresh: ignoreAutoRefresh,
    ...overrides,
  });
