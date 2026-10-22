import type { AuthSessionState } from './auth-context';
import { useAuthContext } from './use-auth-context';

export type { AuthSessionState } from './auth-context';

/**
 * the session of the current user: `loading` until the repository first reports it, then
 * `signed-out` or `signed-in` with the user id. the same object while the user is the same
 */
export const useAuthSession = (): AuthSessionState => useAuthContext().state;
