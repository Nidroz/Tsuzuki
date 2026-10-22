import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type {
  AuthRepository,
  AuthSession,
  CaptchaTokenProvider,
} from '../repositories/auth-repository';
import { AuthContext, type AuthSessionState } from './auth-context';

export interface AuthContextProviderProps {
  /** pass a stable object (module level): a new one subscribes again */
  repository: AuthRepository;
  /** pass a stable object: noCaptcha until a provider is wired (A-08) */
  captcha: CaptchaTokenProvider;
  children: ReactNode;
}

const LOADING: AuthSessionState = { status: 'loading', session: null };
const SIGNED_OUT: AuthSessionState = { status: 'signed-out', session: null };

// the same state object while the user is the same: a token refresh re-renders nothing
const nextState = (current: AuthSessionState, session: AuthSession | null): AuthSessionState => {
  if (session === null) {
    return SIGNED_OUT;
  }
  if (current.status === 'signed-in' && current.session.userId === session.userId) {
    return current;
  }
  return { status: 'signed-in', session: { userId: session.userId } };
};

/**
 * gives the tree the auth repository, the captcha provider and the session state the repository
 * reports (onAuthStateChange, subscribed in an effect, unsubscribed on unmount). the auth hooks
 * read them; render it inside the query client provider, which the auth mutations need
 */
export function AuthContextProvider({ repository, captcha, children }: AuthContextProviderProps) {
  const [state, setState] = useState<AuthSessionState>(LOADING);

  useEffect(
    () =>
      repository.onAuthStateChange((session) => {
        setState((current) => nextState(current, session));
      }),
    [repository],
  );

  const value = useMemo(() => ({ repository, captcha, state }), [repository, captcha, state]);
  return <AuthContext value={value}>{children}</AuthContext>;
}
