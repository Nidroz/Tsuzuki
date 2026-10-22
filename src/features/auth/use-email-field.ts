import { useTranslation } from '@core/i18n/index';

import { AUTH_ERROR_KEYS, rejectsEmail } from './auth-error-keys';
import type { AuthFormFields } from './use-auth-form';

/** the auth call that sends the email of the form: a TanStack mutation result */
export interface EmailCall {
  /** null until the call failed */
  readonly error: unknown;
  readonly reset: () => void;
}

/**
 * the email field of a form whose call can reject the address (`invalid-email`: the server's
 * check, stricter than the form's). the server's problem shows under the field, where the user
 * fixes it, instead of the call's inline error, and goes away as soon as the address is edited
 */
export const useEmailField = (form: AuthFormFields, call: EmailCall) => {
  const { t } = useTranslation();
  const rejected = rejectsEmail(call.error);
  const changeEmail = form.change('email');
  return {
    /** true when the call's error is shown by the field: the screen hides its inline error */
    rejected,
    props: {
      value: form.values.email,
      onChangeText: (text: string) => {
        changeEmail(text);
        if (rejected) {
          call.reset();
        }
      },
      error: rejected ? t(AUTH_ERROR_KEYS['invalid-email']) : form.errorOf('email'),
    },
  };
};
