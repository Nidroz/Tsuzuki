import { use } from 'react';

import { AuthContext, MISSING_AUTH_PROVIDER_MESSAGE, type AuthContextValue } from './auth-context';

/**
 * the auth repository, captcha provider and session state of the nearest AuthContextProvider;
 * throws outside of it. for the auth hooks: screens use useAuthSession and the mutation hooks
 */
export const useAuthContext = (): AuthContextValue => {
  const value = use(AuthContext);
  if (value === null) {
    throw new Error(MISSING_AUTH_PROVIDER_MESSAGE);
  }
  return value;
};
