import type { OAuthProvider } from '../repositories/auth-repository';
import { useAuthContext } from './use-auth-context';

/**
 * the identity providers this build can sign in with, in display order (ADR-0015): one button per
 * entry, none while the list is empty (until A-09 wires the browser session and the providers)
 */
export const useOAuthProviders = (): readonly OAuthProvider[] =>
  useAuthContext().repository.oauthProviders;
