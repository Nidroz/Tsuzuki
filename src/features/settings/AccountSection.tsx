import { useSignOut } from '@core/hooks/use-auth-mutations';
import { useAuthSession } from '@core/hooks/use-auth-session';
import { useTranslation } from '@core/i18n/index';
import { authErrorKey } from '@features/auth/auth-error-keys';
import { AUTH_PATHS } from '@features/auth/auth-routes';
import { Button, InlineError, Spinner, Stack, Text } from '@ui/index';
import { useRouter } from 'expo-router';

const TEST_ID = 'settings-account';

function SignedOut() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Stack gap="sm">
      <Text>{t('settings.account.signedOut')}</Text>
      <Button
        label={t('settings.account.signIn')}
        onPress={() => {
          router.push(AUTH_PATHS.signIn);
        }}
        testID={`${TEST_ID}-sign-in`}
      />
      <Button
        label={t('settings.account.signUp')}
        onPress={() => {
          router.push(AUTH_PATHS.signUp);
        }}
        variant="secondary"
        testID={`${TEST_ID}-sign-up`}
      />
    </Stack>
  );
}

// no confirmation: signing out deletes nothing until the purge of A-06 (FR-25)
function SignedIn() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  return (
    <Stack gap="sm">
      <Text testID={`${TEST_ID}-signed-in`}>{t('settings.account.signedIn')}</Text>
      {signOut.isError ? (
        <InlineError message={t(authErrorKey(signOut.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      <Button
        label={t('settings.account.signOut')}
        onPress={() => {
          signOut.mutate();
        }}
        variant="secondary"
        loading={signOut.isPending}
        loadingLabel={t('settings.account.signingOut')}
        testID={`${TEST_ID}-sign-out`}
      />
    </Stack>
  );
}

/**
 * the account of the settings screen (A-01, FR-21): sign in or create an account while signed out;
 * signed in, a signed-in text (the app holds no email) and sign out
 */
export function AccountSection() {
  const { t } = useTranslation();
  const { status } = useAuthSession();
  return (
    <Stack gap="sm" testID={TEST_ID}>
      <Text variant="subtitle">{t('settings.account.title')}</Text>
      {status === 'loading' ? (
        <Spinner size="small" accessibilityLabel={t('settings.account.loading')} />
      ) : null}
      {status === 'signed-out' ? <SignedOut /> : null}
      {status === 'signed-in' ? <SignedIn /> : null}
    </Stack>
  );
}
