import { OAuthCallbackScreen } from '@features/auth/OAuthCallbackScreen';

// the oauth redirect (tsuzuki://auth/oauth-callback), which android also hands to the router: the
// screen never reads its params and writes nothing, the sign in call exchanges the code (ADR-0015)
export default function OAuthCallbackRoute() {
  return <OAuthCallbackScreen />;
}
