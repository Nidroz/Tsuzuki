import { useTranslation } from '@core/i18n/index';
import { ErrorState, Screen, Spinner } from '@ui/index';
import { useNavigation, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { AUTH_PATHS, OAUTH_SOURCE_ROUTES } from './auth-routes';
import { AUTH_EDGES } from './AuthScreen';

const TEST_ID = 'auth-oauth-callback';

interface StackState {
  readonly index: number;
  readonly routes: readonly { readonly name: string }[];
}

// whether the screen below this one shows the provider buttons. router.canGoBack() is not enough:
// a cold deep link gets the tabs below it (unstable_settings in the root layout)
const returnsToSignIn = (state: StackState | undefined): boolean => {
  const below = state?.routes[state.index - 1];
  return below !== undefined && OAUTH_SOURCE_ROUTES.includes(below.name);
};

/**
 * the oauth redirect `tsuzuki://auth/oauth-callback` (ADR-0015), which android also hands to the
 * router. it never reads or exchanges its params and writes nothing: the sign in call that opened
 * the browser session exchanges the code. on mount it goes back to the sign in or sign up screen
 * below, which awaits that call; otherwise (a cold start after the app was killed in the browser,
 * a stray link) it says sign in did not finish and offers sign in
 */
export function OAuthCallbackScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  // read once: the screen leaves as soon as it goes back
  const [goingBack] = useState(() => returnsToSignIn(navigation.getState()));
  // one back per mount, even when an effect runs twice (react strict mode)
  const wentBackRef = useRef(false);

  useEffect(() => {
    if (goingBack && !wentBackRef.current) {
      wentBackRef.current = true;
      router.back();
    }
  }, [goingBack, router]);

  if (goingBack) {
    return (
      <Screen edges={AUTH_EDGES} testID={`${TEST_ID}-returning`}>
        <Spinner accessibilityLabel={t('auth.oauthCallback.returning')} />
      </Screen>
    );
  }

  return (
    <Screen edges={AUTH_EDGES} testID={`${TEST_ID}-interrupted`}>
      <ErrorState
        title={t('auth.oauthCallback.interrupted.title')}
        message={t('auth.oauthCallback.interrupted.message')}
        retry={{
          label: t('auth.oauthCallback.signIn'),
          onPress: () => {
            router.dismissTo(AUTH_PATHS.signIn);
          },
        }}
      />
    </Screen>
  );
}
