import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import { authWrapper, flushSessionReports } from '../../../test/core/auth-hooks-support';
import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { AuthError } from '../errors/auth-errors';
import type { CaptchaTokenProvider } from '../repositories/auth-repository';
import { useSignInWithProvider } from './use-auth-mutations';
import { useOAuthProviders } from './use-oauth-providers';

const SESSION = { userId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' };

// the captcha is never asked: supabase does not protect the authorize endpoint
const captchaNeverAsked = () => ({
  getToken: jest.fn<CaptchaTokenProvider['getToken']>(() =>
    Promise.reject(new Error('the captcha was asked')),
  ),
});

describe('useSignInWithProvider', () => {
  it.each([
    ['the session', SESSION],
    ['null when the browser was closed or consent declined', null],
  ])('resolves %s, without a captcha', async (_case, session) => {
    const captcha = captchaNeverAsked();
    const repository = createSessionAuthRepository(null, {
      signInWithProvider: () => Promise.resolve(session),
    });
    const { result } = renderHook(useSignInWithProvider, {
      wrapper: authWrapper(repository, { captcha }),
    });

    let data: unknown;
    await act(async () => {
      data = await result.current.mutateAsync('apple');
    });

    expect(data).toStrictEqual(session);
    expect(repository.signInWithProvider).toHaveBeenCalledWith('apple');
    expect(captcha.getToken).not.toHaveBeenCalled();
  });

  it('rejects with the AuthError of the repository', async () => {
    const repository = createSessionAuthRepository(null, {
      signInWithProvider: () => Promise.reject(new AuthError('oauth-failed')),
    });
    const { result } = renderHook(useSignInWithProvider, { wrapper: authWrapper(repository) });

    await act(async () => {
      await expect(result.current.mutateAsync('google')).rejects.toMatchObject({
        reason: 'oauth-failed',
      });
    });

    expect(result.current.isError).toBe(true);
  });
});

describe('useOAuthProviders', () => {
  it.each([
    ['no provider', []],
    ['the providers of the build, in order', ['apple', 'google'] as const],
  ])('returns %s', async (_case, providers) => {
    const repository = createSessionAuthRepository(null, { oauthProviders: providers });
    const { result } = renderHook(useOAuthProviders, { wrapper: authWrapper(repository) });
    await flushSessionReports();

    expect(result.current).toStrictEqual(providers);
  });
});
