import { createContext } from 'react';

import type {
  AuthRepository,
  AuthSession,
  CaptchaTokenProvider,
} from '../repositories/auth-repository';

/**
 * the session as the screens see it (docs/ARCHITECTURE.md §8): `loading` until the repository
 * first reports it, then signed out or signed in with the user id only (no email, no token)
 */
export type AuthSessionState =
  | { readonly status: 'loading'; readonly session: null }
  | { readonly status: 'signed-out'; readonly session: null }
  | { readonly status: 'signed-in'; readonly session: AuthSession };

/** the account of the current user, given by AuthContextProvider */
export interface AuthContextValue {
  /** the auth calls; the auth mutation hooks use it, never the screens */
  readonly repository: AuthRepository;
  /** asked for a token before each protected call (noCaptcha until A-08) */
  readonly captcha: CaptchaTokenProvider;
  readonly state: AuthSessionState;
}

/** the auth repository, the captcha provider and the session state, set by AuthContextProvider */
export const AuthContext = createContext<AuthContextValue | null>(null);

export const MISSING_AUTH_PROVIDER_MESSAGE =
  'an auth hook is used outside AuthContextProvider: render the tree inside AuthContextProvider';
