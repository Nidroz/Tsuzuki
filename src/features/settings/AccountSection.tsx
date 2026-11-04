import { useAuthSession } from '@core/hooks/use-auth-session';
import { useSignOut } from '@core/hooks/use-sign-out';
import { useTranslation } from '@core/i18n/index';
import { authErrorKey } from '@features/auth/auth-error-keys';
import { AUTH_PATHS } from '@features/auth/auth-routes';
import { Button, InlineError, Sheet, SheetActions, Spinner, Stack, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { DELETE_ACCOUNT_PATH } from './settings-routes';

const TEST_ID = 'settings-account';
const UNSYNCED_TEST_ID = `${TEST_ID}-unsynced`;

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

// signing out syncs the library, then purges the user's data from the device (FR-25, ADR-0018).
// changes still unsynced after the sync are lost by the purge: the user confirms first, and Cancel
// only closes the question (the mutation reset), still signed in with nothing touched
function SignedIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const signOut = useSignOut();
  const unsyncedCount = signOut.data?.status === 'unsynced' ? signOut.data.count : null;

  const keepSignedIn = () => {
    signOut.reset();
  };

  const discardAndSignOut = () => {
    signOut.mutate({ discardUnsynced: true });
  };

  return (
    <Stack gap="sm">
      <Text testID={`${TEST_ID}-signed-in`}>{t('settings.account.signedIn')}</Text>
      {signOut.isError ? (
        <InlineError message={t(authErrorKey(signOut.error))} testID={`${TEST_ID}-error`} />
      ) : null}
      <Button
        label={t('settings.account.signOut')}
        onPress={() => {
          signOut.mutate({});
        }}
        variant="secondary"
        loading={signOut.isPending}
        loadingLabel={t('settings.account.signingOut')}
        testID={`${TEST_ID}-sign-out`}
      />
      <Button
        label={t('settings.account.deleteAccount')}
        onPress={() => {
          router.push(DELETE_ACCOUNT_PATH);
        }}
        variant="danger"
        disabled={signOut.isPending}
        testID={`${TEST_ID}-delete-account`}
      />
      <Sheet
        visible={unsyncedCount !== null}
        title={t('settings.account.unsynced.title')}
        closeLabel={t('settings.account.unsynced.close')}
        onClose={keepSignedIn}
        footer={
          <SheetActions
            confirmLabel={t('settings.account.unsynced.confirm', { count: unsyncedCount ?? 0 })}
            confirmVariant="danger"
            onConfirm={discardAndSignOut}
            cancelLabel={t('settings.account.unsynced.cancel')}
            onCancel={keepSignedIn}
            testID={UNSYNCED_TEST_ID}
          />
        }
        testID={UNSYNCED_TEST_ID}
      >
        <Text>{t('settings.account.unsynced.message', { count: unsyncedCount ?? 0 })}</Text>
      </Sheet>
    </Stack>
  );
}

/**
 * the account of the settings screen (A-01, FR-21): sign in or create an account while signed out;
 * signed in, a signed-in text (the app holds no email), sign out (A-06, FR-25) and the way to the
 * account deletion screen (FR-24)
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
