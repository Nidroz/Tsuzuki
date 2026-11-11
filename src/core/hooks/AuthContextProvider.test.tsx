import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import { flushSessionReports, authWrapper } from '../../../test/core/auth-hooks-support';
import {
  createFakeAuthRepository,
  createSessionAuthRepository,
  createSessionSource,
} from '../../../test/core/fake-auth-repository';
import type { CaptchaTokenProvider } from '../repositories/auth-repository';
import { MISSING_AUTH_PROVIDER_MESSAGE } from './auth-context';
import { useAuthContext } from './use-auth-context';
import { useAuthSession } from './use-auth-session';

const USER_ID = '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f';
const OTHER_USER_ID = '0b8f3a12-4c5d-4e6f-8a9b-1c2d3e4f5a6b';

const renderSession = (source = createSessionSource(null)) => {
  const repository = createFakeAuthRepository({ onAuthStateChange: source.subscribe });
  const rendered = renderHook(useAuthSession, { wrapper: authWrapper(repository) });
  return { ...rendered, repository, source };
};

describe('AuthContextProvider', () => {
  it('is loading until the repository reports the session, then signed out', async () => {
    const { result, repository } = renderSession();

    expect(result.current).toStrictEqual({ status: 'loading', session: null });
    expect(repository.onAuthStateChange).toHaveBeenCalledTimes(1);

    await flushSessionReports();

    expect(result.current).toStrictEqual({ status: 'signed-out', session: null });
  });

  it('is signed in with the user id of the reported session', async () => {
    const { result } = renderSession(createSessionSource({ userId: USER_ID }));

    await flushSessionReports();

    expect(result.current).toStrictEqual({ status: 'signed-in', session: { userId: USER_ID } });
  });

  it('keeps the same state object while the user stays the same (a token refresh)', async () => {
    const { result, source } = renderSession(createSessionSource({ userId: USER_ID }));
    await flushSessionReports();
    const signedIn = result.current;

    act(() => {
      source.emit({ userId: USER_ID });
    });

    expect(result.current).toBe(signedIn);

    act(() => {
      source.emit({ userId: OTHER_USER_ID });
    });

    expect(result.current).toStrictEqual({
      status: 'signed-in',
      session: { userId: OTHER_USER_ID },
    });
  });

  it('follows a sign in and a sign out', async () => {
    const { result, source } = renderSession();
    await flushSessionReports();

    act(() => {
      source.emit({ userId: USER_ID });
    });

    expect(result.current.status).toBe('signed-in');

    act(() => {
      source.emit(null);
    });

    expect(result.current).toStrictEqual({ status: 'signed-out', session: null });
  });

  it('reads each reported state at once, before the render that shows it, with a stable readState', async () => {
    const source = createSessionSource({ userId: USER_ID });
    const repository = createFakeAuthRepository({ onAuthStateChange: source.subscribe });
    const { result } = renderHook(useAuthContext, { wrapper: authWrapper(repository) });
    const { readState } = result.current;

    expect(readState()).toStrictEqual({ status: 'loading', session: null });

    await flushSessionReports();
    const signedIn = readState();

    expect(signedIn).toBe(result.current.state);
    expect(signedIn).toStrictEqual({ status: 'signed-in', session: { userId: USER_ID } });

    // read inside the act scope: the render showing the report has not run yet
    const seen: unknown[] = [];
    act(() => {
      source.emit({ userId: USER_ID });
      seen.push(readState());
      source.emit(null);
      seen.push(readState(), result.current.state);
    });

    expect(seen).toStrictEqual([signedIn, { status: 'signed-out', session: null }, signedIn]);
    expect(seen[0]).toBe(signedIn);
    expect(result.current.state).toBe(readState());
    expect(result.current.readState).toBe(readState);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount, source } = renderSession();
    await flushSessionReports();

    expect(source.listenerCount()).toBe(1);

    unmount();

    expect(source.listenerCount()).toBe(0);
  });

  it('gives useAuthContext the repository and the captcha provider themselves', async () => {
    const repository = createSessionAuthRepository();
    const captcha: CaptchaTokenProvider = { getToken: jest.fn<CaptchaTokenProvider['getToken']>() };

    const { result } = renderHook(useAuthContext, {
      wrapper: authWrapper(repository, { captcha }),
    });
    await flushSessionReports();

    expect(result.current.repository).toBe(repository);
    expect(result.current.captcha).toBe(captcha);
    expect(captcha.getToken).not.toHaveBeenCalled();
  });

  it('makes useAuthContext and useAuthSession throw outside of it', () => {
    expect(() => renderHook(useAuthContext)).toThrow(MISSING_AUTH_PROVIDER_MESSAGE);
    expect(() => renderHook(useAuthSession)).toThrow(MISSING_AUTH_PROVIDER_MESSAGE);
  });
});
