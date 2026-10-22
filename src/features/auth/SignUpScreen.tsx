import { useResendConfirmation, useSignUp } from '@core/hooks/use-auth-mutations';
import { useTranslation } from '@core/i18n/index';
import { signUpFormSchema } from '@core/schemas/auth-forms';
import { Button, InlineError, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { authErrorKey } from './auth-error-keys';
import { passwordPolicyText } from './auth-form-texts';
import { AUTH_PATHS } from './auth-routes';
import { EmailField, PasswordField } from './AuthFields';
import { AuthMessage, AuthScreen } from './AuthScreen';
import { useAuthForm } from './use-auth-form';

const TEST_ID = 'auth-sign-up';

interface SentStateProps {
  readonly email: string;
  readonly onSignIn: () => void;
}

// the check-your-email state, the same whether or not the address was already registered
function SentState({ email, onSignIn }: SentStateProps) {
  const { t } = useTranslation();
  const resend = useResendConfirmation();
  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <AuthMessage
        title={t('auth.signUp.sent.title')}
        message={t('auth.signUp.sent.message', { email })}
        testID={`${TEST_ID}-sent`}
      />
      {resend.isSuccess ? (
        <Text testID={`${TEST_ID}-resent`}>{t('auth.signUp.sent.resent')}</Text>
      ) : (
        <Button
          label={t('auth.signUp.sent.resend')}
          onPress={() => {
            resend.mutate(email);
          }}
          variant="secondary"
          loading={resend.isPending}
          loadingLabel={t('auth.signUp.sent.resending')}
          testID={`${TEST_ID}-resend`}
        />
      )}
      {resend.isError ? (
        <InlineError message={t(authErrorKey(resend.error))} testID={`${TEST_ID}-resend-error`} />
      ) : null}
      <Button
        label={t('auth.signUp.sent.signIn')}
        onPress={onSignIn}
        testID={`${TEST_ID}-sign-in`}
      />
    </AuthScreen>
  );
}

/**
 * creates an account (FR-21): an email, a password meeting the policy and its confirmation. the
 * confirmation email follows; an address already registered shows the same check-your-email state,
 * so the screen never tells which addresses have an account
 */
export function SignUpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const form = useAuthForm(signUpFormSchema);
  const signUp = useSignUp();

  const goToSignIn = () => {
    router.dismissTo(AUTH_PATHS.signIn);
  };

  if (signUp.isSuccess) {
    return <SentState email={signUp.variables.email} onSignIn={goToSignIn} />;
  }

  const submit = () => {
    const credentials = form.validate();
    if (credentials !== null) {
      signUp.mutate(credentials);
    }
  };

  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <EmailField
        value={form.values.email}
        onChangeText={form.change('email')}
        error={form.errorOf('email')}
        testID={`${TEST_ID}-email`}
      />
      <PasswordField
        label={t('auth.fields.password')}
        autoComplete="new-password"
        value={form.values.password}
        onChangeText={form.change('password')}
        error={form.errorOf('password')}
        testID={`${TEST_ID}-password`}
      />
      <Text variant="caption" tone="muted">
        {passwordPolicyText(t)}
      </Text>
      <PasswordField
        label={t('auth.fields.passwordConfirmation')}
        autoComplete="new-password"
        value={form.values.passwordConfirmation}
        onChangeText={form.change('passwordConfirmation')}
        error={form.errorOf('passwordConfirmation')}
        onSubmitEditing={submit}
        testID={`${TEST_ID}-password-confirmation`}
      />
      {signUp.isError ? (
        <InlineError message={t(authErrorKey(signUp.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      <Button
        label={t('auth.signUp.submit')}
        onPress={submit}
        loading={signUp.isPending}
        loadingLabel={t('auth.signUp.submitting')}
        testID={`${TEST_ID}-submit`}
      />
      <Button
        label={t('auth.signUp.signIn')}
        onPress={goToSignIn}
        variant="ghost"
        testID={`${TEST_ID}-sign-in`}
      />
    </AuthScreen>
  );
}
