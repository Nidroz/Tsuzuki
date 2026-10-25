import { useSignInWithProvider } from '@core/hooks/use-auth-mutations';
import { useOAuthProviders } from '@core/hooks/use-oauth-providers';
import { useTranslation, type TranslationKey } from '@core/i18n/index';
import type { OAuthProvider } from '@core/repositories/auth-repository';
import { Button, InlineError, Stack, Text } from '@ui/index';
import { useRouter } from 'expo-router';

import { authErrorKey } from './auth-error-keys';
import { SETTINGS_PATH } from './auth-routes';

/** the label of each provider's button */
export const OAUTH_PROVIDER_KEYS = {
  google: 'auth.oauth.google',
  apple: 'auth.oauth.apple',
} as const satisfies Record<OAuthProvider, TranslationKey>;

export interface OAuthButtonsProps {
  /** the testID prefix of the screen: `${testIdPrefix}-oauth-google`, `${testIdPrefix}-oauth-error` */
  testIdPrefix: string;
}

/**
 * sign in with an identity provider (FR-21, ADR-0015): one button per provider of this build, in
 * its order, nothing while the build has none. a tap runs the whole flow (browser session, then
 * code exchange); the other buttons stay disabled meanwhile. success returns to the settings tab;
 * a closed browser or a declined consent leaves the screen as it was
 */
export function OAuthButtons({ testIdPrefix }: OAuthButtonsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const providers = useOAuthProviders();
  const signIn = useSignInWithProvider();

  if (providers.length === 0) {
    return null;
  }

  const start = (provider: OAuthProvider) => {
    signIn.mutate(provider, {
      onSuccess: (session) => {
        if (session !== null) {
          router.dismissTo(SETTINGS_PATH);
        }
      },
    });
  };

  return (
    <Stack gap="sm">
      <Text tone="muted" align="center">
        {t('auth.oauth.separator')}
      </Text>
      {providers.map((provider) => {
        const running = signIn.isPending && signIn.variables === provider;
        return (
          <Button
            key={provider}
            label={t(OAUTH_PROVIDER_KEYS[provider])}
            onPress={() => {
              start(provider);
            }}
            variant="secondary"
            disabled={signIn.isPending && !running}
            loading={running}
            loadingLabel={t('auth.oauth.signingIn')}
            testID={`${testIdPrefix}-oauth-${provider}`}
          />
        );
      })}
      {signIn.isError ? (
        <InlineError
          message={t(authErrorKey(signIn.error))}
          testID={`${testIdPrefix}-oauth-error`}
        />
      ) : null}
    </Stack>
  );
}
