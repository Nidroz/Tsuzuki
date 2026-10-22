// a wrapper giving the auth hooks a query client, an auth repository and a captcha provider, for
// the auth hook tests (src/core/hooks/)
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AuthContextProvider } from '@core/hooks/AuthContextProvider';
import { createQueryClient } from '@core/query/query-client';
import {
  noCaptcha,
  type AuthRepository,
  type CaptchaTokenProvider,
} from '@core/repositories/auth-repository';

export interface AuthWrapperOptions {
  readonly captcha?: CaptchaTokenProvider;
  readonly queryClient?: QueryClient;
}

/** the providers of the composition root the auth hooks need: the query client, then the auth */
export const authWrapper = (
  repository: AuthRepository,
  { captcha = noCaptcha, queryClient = createQueryClient() }: AuthWrapperOptions = {},
) =>
  function AuthWrapper({ children }: { readonly children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthContextProvider repository={repository} captcha={captcha}>
          {children}
        </AuthContextProvider>
      </QueryClientProvider>
    );
  };

/** settles the pending promise callbacks (the session reported after subscribing) inside act */
export const flushSessionReports = () =>
  act(async () => {
    await Promise.resolve();
  });
