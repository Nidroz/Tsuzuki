import { describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';

import { authWrapper } from '../../../test/core/auth-hooks-support';
import { createSessionAuthRepository } from '../../../test/core/fake-auth-repository';
import { AuthError } from '../errors/auth-errors';
import { createQueryClient } from '../query/query-client';
import type { AuthRepository } from '../repositories/auth-repository';
import { useCompletePasswordReset, useSignIn, useSignOut } from './use-auth-mutations';

const SESSION = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const LINK = { code: '3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8', flowId: 'flow_id-12345' };
const OTHER_LINK = { code: '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b', flowId: 'flow_id-67890' };
const PASSWORD = 'new-password-2026';
const CREDENTIALS = { email: 'reader@example.test', password: 'correct-horse-42' };

const renderReset = (repository: AuthRepository) =>
  renderHook(useCompletePasswordReset, { wrapper: authWrapper(repository) });

describe('useCompletePasswordReset', () => {
  it('exchanges the code, then sets the password', async () => {
    const calls: string[] = [];
    const repository = createSessionAuthRepository(null, {
      completeEmailLink: () => {
        calls.push('completeEmailLink');
        return Promise.resolve(SESSION);
      },
      updatePassword: () => {
        calls.push('updatePassword');
        return Promise.resolve();
      },
    });
    const { result } = renderReset(repository);

    await act(() => result.current.mutateAsync({ link: LINK, password: PASSWORD }));

    expect(calls).toStrictEqual(['completeEmailLink', 'updatePassword']);
    expect(repository.completeEmailLink).toHaveBeenCalledWith(LINK);
    expect(repository.updatePassword).toHaveBeenCalledWith(PASSWORD);
  });

  it('sets nothing when the exchange fails, and exchanges again on a retry', async () => {
    const repository = createSessionAuthRepository(null, {
      completeEmailLink: () => Promise.reject(new AuthError('network')),
      updatePassword: () => Promise.resolve(),
    });
    const { result } = renderReset(repository);

    await act(async () => {
      await expect(result.current.mutateAsync({ link: LINK, password: PASSWORD })).rejects.toThrow(
        AuthError,
      );
    });

    expect(repository.updatePassword).not.toHaveBeenCalled();

    repository.completeEmailLink.mockResolvedValueOnce(SESSION);
    await act(() => result.current.mutateAsync({ link: LINK, password: PASSWORD }));

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(2);
    expect(repository.updatePassword).toHaveBeenCalledTimes(1);
  });

  it('retries only the password update once the code was exchanged', async () => {
    const repository = createSessionAuthRepository(null, {
      completeEmailLink: () => Promise.resolve(SESSION),
      updatePassword: () => Promise.reject(new AuthError('same-password')),
    });
    const { result } = renderReset(repository);

    await act(async () => {
      await expect(
        result.current.mutateAsync({ link: LINK, password: PASSWORD }),
      ).rejects.toMatchObject({ reason: 'same-password' });
    });

    repository.updatePassword.mockResolvedValueOnce(undefined);
    await act(() => result.current.mutateAsync({ link: LINK, password: `${PASSWORD}!` }));

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
    expect(repository.updatePassword).toHaveBeenCalledTimes(2);
    expect(repository.updatePassword).toHaveBeenLastCalledWith(`${PASSWORD}!`);
  });

  it('exchanges another code', async () => {
    const repository = createSessionAuthRepository(null, {
      completeEmailLink: () => Promise.resolve(SESSION),
      updatePassword: () => Promise.resolve(),
    });
    const { result } = renderReset(repository);

    await act(() => result.current.mutateAsync({ link: LINK, password: PASSWORD }));
    await act(() => result.current.mutateAsync({ link: OTHER_LINK, password: PASSWORD }));

    expect(repository.completeEmailLink).toHaveBeenCalledTimes(2);
    expect(repository.completeEmailLink).toHaveBeenLastCalledWith(OTHER_LINK);
  });
});

describe('useSignOut', () => {
  it('signs out', async () => {
    const repository = createSessionAuthRepository(SESSION, { signOut: () => Promise.resolve() });
    const { result } = renderHook(useSignOut, { wrapper: authWrapper(repository) });

    await act(() => result.current.mutateAsync());

    expect(repository.signOut).toHaveBeenCalledTimes(1);
  });

  it('rejects with the AuthError of the repository', async () => {
    const repository = createSessionAuthRepository(SESSION, {
      signOut: () => Promise.reject(new AuthError('network')),
    });
    const { result } = renderHook(useSignOut, { wrapper: authWrapper(repository) });

    await act(async () => {
      await expect(result.current.mutateAsync()).rejects.toMatchObject({ reason: 'network' });
    });
  });
});

describe('auth mutation options', () => {
  it('runs offline instead of pausing: the call fails or succeeds at once', async () => {
    const repository = createSessionAuthRepository(null, {
      signIn: () => Promise.resolve(SESSION),
    });
    const { result } = renderHook(useSignIn, { wrapper: authWrapper(repository) });
    onlineManager.setOnline(false);
    try {
      await act(() => result.current.mutateAsync(CREDENTIALS));
    } finally {
      onlineManager.setOnline(true);
    }

    expect(repository.signIn).toHaveBeenCalledTimes(1);
  });

  it('drops the mutation, variables included, once no screen observes it', async () => {
    const queryClient = createQueryClient();
    const repository = createSessionAuthRepository(null, {
      signIn: () => Promise.resolve(SESSION),
    });
    const { result, unmount } = renderHook(useSignIn, {
      wrapper: authWrapper(repository, { queryClient }),
    });
    await act(() => result.current.mutateAsync(CREDENTIALS));

    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});
