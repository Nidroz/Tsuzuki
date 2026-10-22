import { describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react';

import { authWrapper } from '../../../test/core/auth-hooks-support';
import {
  createSessionAuthRepository,
  type FakeAuthRepository,
} from '../../../test/core/fake-auth-repository';
import { AuthError } from '../errors/auth-errors';
import type {
  AuthRepository,
  CaptchaAction,
  CaptchaTokenProvider,
  EmailCredentials,
} from '../repositories/auth-repository';
import {
  useCompleteEmailLink,
  useRequestPasswordReset,
  useResendConfirmation,
  useSignIn,
  useSignUp,
} from './use-auth-mutations';

const EMAIL = 'reader@example.test';
const CREDENTIALS: EmailCredentials = { email: EMAIL, password: 'correct-horse-42' };
const SESSION = { userId: '7d4c0f52-7b8e-4a43-9f8a-2f1b3c4d5e6f' };
const LINK = { code: '3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8', flowId: 'flow_id-12345' };
const CAPTCHA_TOKEN = 'captcha-token';

const resolved = () => Promise.resolve();

const captchaReturning = (token: string | null) => ({
  getToken: jest.fn<CaptchaTokenProvider['getToken']>(() => Promise.resolve(token)),
});

// one protected action: its hook, the repository method it calls, the captcha action and the
// arguments the hook takes and passes on
interface ProtectedCase {
  readonly name: string;
  readonly method: 'signUp' | 'resendConfirmation' | 'signIn' | 'requestPasswordReset';
  readonly action: CaptchaAction;
  readonly run: (repository: FakeAuthRepository, captcha: CaptchaTokenProvider) => Promise<unknown>;
  readonly argument: EmailCredentials | string;
}

const runHook = async <T,>(
  useHook: () => { mutateAsync: (variables: T) => Promise<unknown> },
  variables: T,
  repository: AuthRepository,
  captcha: CaptchaTokenProvider,
) => {
  const { result } = renderHook(useHook, { wrapper: authWrapper(repository, { captcha }) });
  let data: unknown;
  await act(async () => {
    data = await result.current.mutateAsync(variables);
  });
  return data;
};

const PROTECTED_CASES: readonly ProtectedCase[] = [
  {
    name: 'useSignUp',
    method: 'signUp',
    action: 'sign-up',
    argument: CREDENTIALS,
    run: (repository, captcha) => runHook(useSignUp, CREDENTIALS, repository, captcha),
  },
  {
    name: 'useResendConfirmation',
    method: 'resendConfirmation',
    action: 'resend-confirmation',
    argument: EMAIL,
    run: (repository, captcha) => runHook(useResendConfirmation, EMAIL, repository, captcha),
  },
  {
    name: 'useSignIn',
    method: 'signIn',
    action: 'sign-in',
    argument: CREDENTIALS,
    run: (repository, captcha) => runHook(useSignIn, CREDENTIALS, repository, captcha),
  },
  {
    name: 'useRequestPasswordReset',
    method: 'requestPasswordReset',
    action: 'password-reset',
    argument: EMAIL,
    run: (repository, captcha) => runHook(useRequestPasswordReset, EMAIL, repository, captcha),
  },
];

const protectedRepository = () =>
  createSessionAuthRepository(null, {
    signUp: resolved,
    resendConfirmation: resolved,
    signIn: () => Promise.resolve(SESSION),
    requestPasswordReset: resolved,
  });

describe.each(PROTECTED_CASES)('$name', ({ method, action, argument, run }) => {
  it(`asks the captcha for a ${action} token, and sends no options without one`, async () => {
    const repository = protectedRepository();
    const captcha = captchaReturning(null);

    await run(repository, captcha);

    expect(captcha.getToken).toHaveBeenCalledTimes(1);
    expect(captcha.getToken).toHaveBeenCalledWith(action);
    expect(repository[method]).toHaveBeenCalledTimes(1);
    expect(repository[method]).toHaveBeenCalledWith(argument, undefined);
  });

  it('sends the captcha token when there is one', async () => {
    const repository = protectedRepository();

    await run(repository, captchaReturning(CAPTCHA_TOKEN));

    expect(repository[method]).toHaveBeenCalledWith(argument, { captchaToken: CAPTCHA_TOKEN });
  });

  it('calls nothing when the captcha fails, and rejects with its error', async () => {
    const repository = protectedRepository();
    const failure = new AuthError('captcha-failed');
    const captcha = {
      getToken: jest.fn<CaptchaTokenProvider['getToken']>(() => Promise.reject(failure)),
    };

    await expect(run(repository, captcha)).rejects.toBe(failure);
    expect(repository[method]).not.toHaveBeenCalled();
  });

  it('rejects with the AuthError of the repository', async () => {
    const failure = new AuthError('rate-limited');
    const repository = createSessionAuthRepository(null, {
      [method]: () => Promise.reject(failure),
    });

    await expect(run(repository, captchaReturning(null))).rejects.toBe(failure);
  });
});

describe('useSignIn', () => {
  it('resolves to the session', async () => {
    await expect(
      runHook(useSignIn, CREDENTIALS, protectedRepository(), captchaReturning(null)),
    ).resolves.toStrictEqual(SESSION);
  });
});

describe('useCompleteEmailLink', () => {
  it('exchanges the link without asking the captcha, and resolves to the session', async () => {
    const repository = createSessionAuthRepository(null, {
      completeEmailLink: () => Promise.resolve(SESSION),
    });
    const captcha = captchaReturning(CAPTCHA_TOKEN);

    await expect(runHook(useCompleteEmailLink, LINK, repository, captcha)).resolves.toStrictEqual(
      SESSION,
    );
    expect(repository.completeEmailLink).toHaveBeenCalledTimes(1);
    expect(repository.completeEmailLink).toHaveBeenCalledWith(LINK);
    expect(captcha.getToken).not.toHaveBeenCalled();
  });
});
