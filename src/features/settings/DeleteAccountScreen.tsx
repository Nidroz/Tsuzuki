import { useAuthSession } from '@core/hooks/use-auth-session';
import { useDeleteAccount } from '@core/hooks/use-delete-account';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import { AUTH_PATHS, SETTINGS_PATH } from '@features/auth/auth-routes';
import {
  Button,
  InlineError,
  Screen,
  Sheet,
  SheetActions,
  Spinner,
  Stack,
  Text,
  type ScreenEdge,
} from '@ui/index';
import { useRouter } from 'expo-router';
import { useState } from 'react';

import { accountDeletionErrorKey } from './account-deletion-error-keys';

const TEST_ID = 'delete-account';
const CONFIRM_TEST_ID = `${TEST_ID}-confirm`;

// under the root stack header, without a tab bar: the bottom and the sides need the safe area
const EDGES: readonly ScreenEdge[] = ['bottom', 'left', 'right'];

// what a deletion removes, in the order the screen lists it (ADR-0018 "Account deletion, client")
const DELETED_ITEM_KEYS = [
  'settings.deleteAccount.items.account',
  'settings.deleteAccount.items.library',
  'settings.deleteAccount.items.history',
  'settings.deleteAccount.items.device',
] as const satisfies readonly TranslationKey[];

interface MessageProps {
  readonly title: string;
  readonly message: string;
}

// a headline, announced as a heading, and its message
function Message({ title, message }: MessageProps) {
  return (
    <Stack gap="sm">
      <Text variant="title">{title}</Text>
      <Text>{message}</Text>
    </Stack>
  );
}

// signed out: nothing to delete, and a link never deletes anything by itself
function SignInFirst() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Stack gap="lg" testID={`${TEST_ID}-signed-out`}>
      <Message
        title={t('settings.deleteAccount.signedOut.title')}
        message={t('settings.deleteAccount.signedOut.message')}
      />
      <Button
        label={t('settings.deleteAccount.signedOut.signIn')}
        onPress={() => {
          router.push(AUTH_PATHS.signIn);
        }}
        testID={`${TEST_ID}-sign-in`}
      />
    </Stack>
  );
}

// the account is gone and the device signed out: this state outlives the signed-out session
function Deleted() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Stack gap="lg" testID={`${TEST_ID}-deleted`}>
      <Message
        title={t('settings.deleteAccount.deleted.title')}
        message={t('settings.deleteAccount.deleted.message')}
      />
      <Button
        label={t('settings.deleteAccount.deleted.back')}
        onPress={() => {
          router.dismissTo(SETTINGS_PATH);
        }}
        testID={`${TEST_ID}-back`}
      />
    </Stack>
  );
}

interface DeletionFormProps {
  readonly pending: boolean;
  /** the error of the last attempt, null when none failed */
  readonly error: unknown;
  /** the user confirmed twice: delete the account */
  readonly onDelete: () => void;
}

// what is deleted, then a destructive button that only opens the confirmation: two deliberate taps
function DeletionForm({ pending, error, onDelete }: DeletionFormProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  const close = () => {
    setConfirming(false);
  };

  const confirm = () => {
    setConfirming(false);
    onDelete();
  };

  return (
    <Stack gap="lg" testID={`${TEST_ID}-form`}>
      <Stack gap="sm">
        <Text variant="title">{t('settings.deleteAccount.heading')}</Text>
        <Text>{t('settings.deleteAccount.intro')}</Text>
        {DELETED_ITEM_KEYS.map((key) => (
          <Text key={key}>{t(key)}</Text>
        ))}
        <Text variant="label" tone="danger">
          {t('settings.deleteAccount.irreversible')}
        </Text>
      </Stack>
      {error === null ? null : (
        <InlineError message={t(accountDeletionErrorKey(error))} testID={`${TEST_ID}-error`} />
      )}
      <Button
        label={t('settings.deleteAccount.delete')}
        variant="danger"
        onPress={() => {
          setConfirming(true);
        }}
        loading={pending}
        loadingLabel={t('settings.deleteAccount.deleting')}
        testID={`${TEST_ID}-delete`}
      />
      <Sheet
        visible={confirming}
        title={t('settings.deleteAccount.confirm.title')}
        closeLabel={t('settings.deleteAccount.confirm.close')}
        onClose={close}
        footer={
          <SheetActions
            confirmLabel={t('settings.deleteAccount.confirm.confirm')}
            confirmVariant="danger"
            onConfirm={confirm}
            cancelLabel={t('settings.deleteAccount.confirm.cancel')}
            onCancel={close}
            testID={CONFIRM_TEST_ID}
          />
        }
        testID={CONFIRM_TEST_ID}
      >
        <Text>{t('settings.deleteAccount.confirm.message')}</Text>
      </Sheet>
    </Stack>
  );
}

/**
 * the account deletion (FR-24, ADR-0018 "Account deletion, client"): signed in only, it lists what
 * is deleted and that it cannot be undone, and deletes after a destructive button and a
 * destructive confirmation. it reads no param: a link opens it at most. while the deletion runs,
 * the pending form shows even once its local sign out ended the session; a failure shows its
 * translated reason, still signed in; a success shows the deleted state, then back to settings
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { status } = useAuthSession();
  const deletion = useDeleteAccount();

  const content = () => {
    // the deletion first, whatever the session: it signs the device out before it resolves
    if (deletion.isSuccess) {
      return <Deleted />;
    }
    if (deletion.isPending || status === 'signed-in') {
      return (
        <DeletionForm
          pending={deletion.isPending}
          error={deletion.error}
          onDelete={() => {
            deletion.mutate();
          }}
        />
      );
    }
    if (status === 'signed-out') {
      return <SignInFirst />;
    }
    return <Spinner accessibilityLabel={t('settings.deleteAccount.loading')} />;
  };

  return (
    <Screen scroll edges={EDGES} testID={`${TEST_ID}-screen`}>
      {content()}
    </Screen>
  );
}
