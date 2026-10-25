import { useResendConfirmation, useSignIn } from '@core/hooks/use-auth-mutations';
import { useTranslation } from '@core/i18n/index';
import { signInFormSchema } from '@core/schemas/auth-forms';
import { Button, InlineError, Stack, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { authErrorKey, authErrorReason } from './auth-error-keys';
import { AUTH_PATHS, SETTINGS_PATH } from './auth-routes';
import { EmailField, PasswordField } from './AuthFields';
import { AuthScreen } from './AuthScreen';
import { OAuthButtons } from './OAuthButtons';
import { useAuthForm } from './use-auth-form';
import { useEmailField } from './use-email-field';

const TEST_ID = 'auth-sign-in';

/**
 * sign in with an email and a password (FR-21). the form checks no password policy (the server's),
 * only what no account can have. an unconfirmed email offers to resend the confirmation email to
 * the address that was submitted. below the form, the identity providers of the build (OAuthButtons).
 * success returns to the settings tab
 */
export function SignInScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const form = useAuthForm(signInFormSchema);
  const signIn = useSignIn();
  const resend = useResendConfirmation();
  const email = useEmailField(form, signIn);

  const submit = () => {
    const credentials = form.validate();
    if (credentials === null) {
      return;
    }
    resend.reset();
    signIn.mutate(credentials, {
      onSuccess: () => {
        router.dismissTo(SETTINGS_PATH);
      },
    });
  };

  // the address of the attempt that failed, not the field, which may have changed since
  const submittedEmail = signIn.variables?.email;
  const notConfirmed = signIn.isError && authErrorReason(signIn.error) === 'email-not-confirmed';
  const resendConfirmation = () => {
    if (submittedEmail !== undefined) {
      resend.mutate(submittedEmail);
    }
  };

  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <EmailField {...email.props} testID={`${TEST_ID}-email`} />
      <PasswordField
        label={t('auth.fields.password')}
        autoComplete="password"
        value={form.values.password}
        onChangeText={form.change('password')}
        error={form.errorOf('password')}
        onSubmitEditing={submit}
        testID={`${TEST_ID}-password`}
      />
      {signIn.isError && !email.rejected ? (
        <InlineError message={t(authErrorKey(signIn.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      {notConfirmed ? (
        <Stack gap="sm">
          {resend.isSuccess ? (
            <Text testID={`${TEST_ID}-resent`}>{t('auth.signIn.resent')}</Text>
          ) : (
            <Button
              label={t('auth.signIn.resend')}
              onPress={resendConfirmation}
              variant="secondary"
              loading={resend.isPending}
              loadingLabel={t('auth.signIn.resending')}
              testID={`${TEST_ID}-resend`}
            />
          )}
          {resend.isError ? (
            <InlineError
              message={t(authErrorKey(resend.error))}
              testID={`${TEST_ID}-resend-error`}
            />
          ) : null}
        </Stack>
      ) : null}
      <Button
        label={t('auth.signIn.submit')}
        onPress={submit}
        loading={signIn.isPending}
        loadingLabel={t('auth.signIn.submitting')}
        testID={`${TEST_ID}-submit`}
      />
      <Button
        label={t('auth.signIn.forgotPassword')}
        onPress={() => {
          router.push(AUTH_PATHS.forgotPassword);
        }}
        variant="ghost"
        testID={`${TEST_ID}-forgot-password`}
      />
      <OAuthButtons testIdPrefix={TEST_ID} />
      <Button
        label={t('auth.signIn.createAccount')}
        onPress={() => {
          router.push(AUTH_PATHS.signUp);
        }}
        variant="ghost"
        testID={`${TEST_ID}-create-account`}
      />
    </AuthScreen>
  );
}
