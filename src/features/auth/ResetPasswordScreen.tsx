import { useCompletePasswordReset } from '@core/hooks/use-auth-mutations';
import { useTranslation } from '@core/i18n/index';
import type { EmailLinkCode } from '@core/repositories/auth-repository';
import { parseAuthLinkParams } from '@core/schemas/auth-link-params';
import { newPasswordFormSchema } from '@core/schemas/auth-forms';
import { Button, ErrorState, InlineError, Screen, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { authErrorKey } from './auth-error-keys';
import { passwordPolicyText } from './auth-form-texts';
import { AUTH_PATHS, SETTINGS_PATH } from './auth-routes';
import { PasswordField } from './AuthFields';
import { AUTH_EDGES, AuthScreen } from './AuthScreen';
import { useAuthForm } from './use-auth-form';

const TEST_ID = 'auth-reset-password';

export interface ResetPasswordScreenProps {
  /** the raw route params, untrusted: any app or page can open the link */
  params: unknown;
}

interface FailedLinkProps {
  readonly reason: 'expired' | 'invalid';
  readonly onRequestLink: () => void;
}

// a link that cannot be used: a new recovery email is the way on
function FailedLink({ reason, onRequestLink }: FailedLinkProps) {
  const { t } = useTranslation();
  const expired = reason === 'expired';
  return (
    <Screen edges={AUTH_EDGES} testID={`${TEST_ID}-${reason}`}>
      <ErrorState
        title={t(expired ? 'auth.resetPassword.expired.title' : 'auth.resetPassword.invalid.title')}
        message={t(
          expired ? 'auth.resetPassword.expired.message' : 'auth.resetPassword.invalid.message',
        )}
        retry={{ label: t('auth.resetPassword.requestLink'), onPress: onRequestLink }}
      />
    </Screen>
  );
}

interface NewPasswordFormProps {
  readonly link: EmailLinkCode;
  readonly onRequestLink: () => void;
}

// the new password is validated before anything is sent: the link signs the user in only once a
// valid password was chosen. the code is exchanged once, a retry only sets the password again
function NewPasswordForm({ link, onRequestLink }: NewPasswordFormProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const form = useAuthForm(newPasswordFormSchema);
  const reset = useCompletePasswordReset();

  // a failed exchange spends the link whatever its reason: never submit its code again. a failed
  // update keeps the form, since the user is signed in with the recovery session
  if (reset.failedStep === 'exchange') {
    return <FailedLink reason="invalid" onRequestLink={onRequestLink} />;
  }

  const submit = () => {
    const value = form.validate();
    if (value === null) {
      return;
    }
    reset.mutate(
      { link, password: value.password },
      {
        onSuccess: () => {
          router.dismissTo(SETTINGS_PATH);
        },
      },
    );
  };

  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <Text>{t('auth.resetPassword.intro')}</Text>
      <PasswordField
        label={t('auth.fields.newPassword')}
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
        label={t('auth.fields.newPasswordConfirmation')}
        autoComplete="new-password"
        value={form.values.passwordConfirmation}
        onChangeText={form.change('passwordConfirmation')}
        error={form.errorOf('passwordConfirmation')}
        onSubmitEditing={submit}
        testID={`${TEST_ID}-password-confirmation`}
      />
      {reset.failedStep === 'update' ? (
        <InlineError message={t(authErrorKey(reset.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      <Button
        label={t('auth.resetPassword.submit')}
        onPress={submit}
        loading={reset.isPending}
        loadingLabel={t('auth.resetPassword.submitting')}
        testID={`${TEST_ID}-submit`}
      />
    </AuthScreen>
  );
}

/**
 * the recovery link `tsuzuki://auth/reset-password` (ADR-0014). opening it writes nothing: its
 * params are parsed, and the code is exchanged only on submit of a valid new password. an expired
 * or invalid link offers a new one (forgot password)
 */
export function ResetPasswordScreen({ params }: ResetPasswordScreenProps) {
  const router = useRouter();
  const requestLink = () => {
    router.dismissTo(AUTH_PATHS.forgotPassword);
  };
  const parsed = parseAuthLinkParams(params);

  return parsed.kind === 'code' ? (
    <NewPasswordForm link={parsed.link} onRequestLink={requestLink} />
  ) : (
    <FailedLink reason={parsed.reason} onRequestLink={requestLink} />
  );
}
