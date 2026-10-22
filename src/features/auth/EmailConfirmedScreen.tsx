import { useCompleteEmailLink } from '@core/hooks/use-auth-mutations';
import { useTranslation } from '@core/i18n/index';
import type { EmailLinkCode } from '@core/repositories/auth-repository';
import { parseAuthLinkParams } from '@core/schemas/auth-link-params';
import { Button, ErrorState, Screen } from '@ui/index';
import { useRouter } from 'expo-router';

import { AUTH_PATHS, SETTINGS_PATH } from './auth-routes';
import { AUTH_EDGES, AuthMessage, AuthScreen } from './AuthScreen';

const TEST_ID = 'auth-callback';

export interface EmailConfirmedScreenProps {
  /** the raw route params, untrusted: any app or page can open the link */
  params: unknown;
}

interface LinkProps {
  readonly link: EmailLinkCode;
  readonly onSignIn: () => void;
}

// the server confirmed the email before redirecting here: Continue exchanges the code and signs in
function ConfirmedLink({ link, onSignIn }: LinkProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const complete = useCompleteEmailLink();

  // a failed exchange is final (`link-invalid`): the code has no verifier on this device (another
  // device, a reinstall, a newer request, a link from someone else), or the failed attempt, a lost
  // connection included, consumed it. the email is confirmed anyway: the user signs in instead
  if (complete.isError) {
    return (
      <AuthScreen testID={`${TEST_ID}-screen`}>
        <AuthMessage
          title={t('auth.emailConfirmed.signInRequired.title')}
          message={t('auth.emailConfirmed.signInRequired.message')}
          testID={`${TEST_ID}-sign-in-required`}
        />
        <Button
          label={t('auth.emailConfirmed.signIn')}
          onPress={onSignIn}
          testID={`${TEST_ID}-sign-in`}
        />
      </AuthScreen>
    );
  }

  const continueToApp = () => {
    complete.mutate(link, {
      onSuccess: () => {
        router.dismissTo(SETTINGS_PATH);
      },
    });
  };

  return (
    <AuthScreen testID={`${TEST_ID}-screen`}>
      <AuthMessage
        title={t('auth.emailConfirmed.confirmed.title')}
        message={t('auth.emailConfirmed.confirmed.message')}
        testID={`${TEST_ID}-confirmed`}
      />
      <Button
        label={t('auth.emailConfirmed.continue')}
        onPress={continueToApp}
        loading={complete.isPending}
        loadingLabel={t('auth.emailConfirmed.continuing')}
        testID={`${TEST_ID}-continue`}
      />
    </AuthScreen>
  );
}

/**
 * the confirmation link `tsuzuki://auth/callback` (ADR-0014). opening it writes nothing: its params
 * are parsed, and the code is exchanged for a session only when the user taps Continue. an expired
 * or invalid link offers sign in, where an unconfirmed email can ask for a new link
 */
export function EmailConfirmedScreen({ params }: EmailConfirmedScreenProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const goToSignIn = () => {
    router.dismissTo(AUTH_PATHS.signIn);
  };
  const parsed = parseAuthLinkParams(params);

  if (parsed.kind === 'code') {
    return <ConfirmedLink link={parsed.link} onSignIn={goToSignIn} />;
  }

  const expired = parsed.reason === 'expired';
  return (
    <Screen edges={AUTH_EDGES} testID={expired ? `${TEST_ID}-expired` : `${TEST_ID}-invalid`}>
      <ErrorState
        title={t(
          expired ? 'auth.emailConfirmed.expired.title' : 'auth.emailConfirmed.invalid.title',
        )}
        message={t(
          expired ? 'auth.emailConfirmed.expired.message' : 'auth.emailConfirmed.invalid.message',
        )}
        retry={{ label: t('auth.emailConfirmed.signIn'), onPress: goToSignIn }}
      />
    </Screen>
  );
}
