import { AuthError } from '@core/errors/auth-errors';
import type { AuthFormField } from '@core/schemas/auth-forms';
import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { providersFor } from '../../../test/mobile/render-with-providers';
import type { AuthFormFields } from './use-auth-form';
import { useEmailField, type EmailCall } from './use-email-field';

const EMAIL = 'reader@example.test';
const FORM_PROBLEM = 'Enter a valid email address.';
const REJECTED_TEXT = 'This email address is not accepted. Check it, or use another one.';

// a form whose email holds EMAIL and shows `problem`; its change handlers are mocks
const fakeForm = (problem = '') => {
  const changeEmail = jest.fn<(text: string) => void>();
  const form: AuthFormFields = {
    values: { email: EMAIL, password: '', passwordConfirmation: '' },
    change: (field: AuthFormField) => (field === 'email' ? changeEmail : jest.fn()),
    errorOf: (field: AuthFormField) => (field === 'email' ? problem : ''),
  };
  return { form, changeEmail };
};

const fakeCall = (error: unknown): EmailCall & { reset: jest.Mock<() => void> } => ({
  error,
  reset: jest.fn<() => void>(),
});

const renderField = async (form: AuthFormFields, call: EmailCall) => {
  const { result } = await renderHook(() => useEmailField(form, call), {
    wrapper: providersFor(),
  });
  return result.current;
};

describe('useEmailField', () => {
  it('shows the value and the problem of the form while the call has not failed', async () => {
    const { form } = fakeForm(FORM_PROBLEM);

    const field = await renderField(form, fakeCall(null));

    expect(field.rejected).toBe(false);
    expect(field.props.value).toBe(EMAIL);
    expect(field.props.error).toBe(FORM_PROBLEM);
  });

  it('shows an address the server rejected under the field, in place of the form problem', async () => {
    const { form } = fakeForm(FORM_PROBLEM);

    const field = await renderField(form, fakeCall(new AuthError('invalid-email')));

    expect(field.rejected).toBe(true);
    expect(field.props.error).toBe(REJECTED_TEXT);
  });

  it('clears the rejected address as soon as it is edited', async () => {
    const { form, changeEmail } = fakeForm();
    const call = fakeCall(new AuthError('invalid-email'));

    const field = await renderField(form, call);
    field.props.onChangeText(`${EMAIL}x`);

    expect(changeEmail).toHaveBeenCalledWith(`${EMAIL}x`);
    expect(call.reset).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['another reason', new AuthError('rate-limited')],
    ['an error that is not an AuthError', new Error('invalid-email')],
  ])('leaves %s to the inline error of the screen, and keeps it on edit', async (_case, error) => {
    const { form, changeEmail } = fakeForm();
    const call = fakeCall(error);

    const field = await renderField(form, call);
    field.props.onChangeText('r');

    expect(field.rejected).toBe(false);
    expect(field.props.error).toBe('');
    expect(changeEmail).toHaveBeenCalledWith('r');
    expect(call.reset).not.toHaveBeenCalled();
  });
});
