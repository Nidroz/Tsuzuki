import { useRequestPasswordReset } from '@core/hooks/use-auth-mutations';
import { useTranslation } from '@core/i18n/index';
import { emailFormSchema } from '@core/schemas/auth-forms';
import { Button, InlineError, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { authErrorKey } from './auth-error-keys';
import { AUTH_PATHS } from './auth-routes';
import { EmailField } from './AuthFields';
import { AuthMessage, AuthScreen } from './AuthScreen';
import { useAuthForm } from './use-auth-form';

const TEST_ID = 'auth-forgot-password';

/**
 * asks for a recovery email (FR-21). the sent state is the same whether or not an account exists
 * for the address, so the screen never tells which addresses have an account
 */
export function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const form = useAuthForm(emailFormSchema);
  const reset = useRequestPasswordReset();

  const goToSignIn = () => {
    router.dismissTo(AUTH_PATHS.signIn);
  };

  if (reset.isSuccess) {
    return (
      <AuthScreen testID={`${TEST_ID}-screen`}>
        <AuthMessage
          title={t('auth.forgotPassword.sent.title')}
          message={t('auth.forgotPassword.sent.message', { email: reset.variables })}
          testID={`${TEST_ID}-sent`}
        />
        <Button
          label={t('auth.forgotPassword.sent.signIn')}
          onPress={goToSignIn}
          testID={`${TEST_ID}-sign-in`}
        />
      </AuthScreen>
    );
  }

  const submit = () => {
    const value = form.validate();
    if (value !== null) {
      reset.mutate(value.email);
    }
  };

  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <Text>{t('auth.forgotPassword.intro')}</Text>
      <EmailField
        value={form.values.email}
        onChangeText={form.change('email')}
        error={form.errorOf('email')}
        onSubmitEditing={submit}
        testID={`${TEST_ID}-email`}
      />
      {reset.isError ? (
        <InlineError message={t(authErrorKey(reset.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      <Button
        label={t('auth.forgotPassword.submit')}
        onPress={submit}
        loading={reset.isPending}
        loadingLabel={t('auth.forgotPassword.submitting')}
        testID={`${TEST_ID}-submit`}
      />
    </AuthScreen>
  );
}
