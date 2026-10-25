// the paths of the auth screens (app/auth/) and where a completed flow returns: the settings tab,
// whose account section shows the signed-in state (docs/ARCHITECTURE.md §8)

export const AUTH_PATHS = {
  signIn: '/auth/sign-in',
  signUp: '/auth/sign-up',
  forgotPassword: '/auth/forgot-password',
} as const;

/** the settings tab: every completed auth flow returns there with router.dismissTo */
export const SETTINGS_PATH = '/settings';

/**
 * the root stack routes that show the provider buttons (OAuthButtons), by route name: the oauth
 * redirect route returns to one of them, where the sign in call awaits the browser session
 */
export const OAUTH_SOURCE_ROUTES: readonly string[] = ['auth/sign-in', 'auth/sign-up'];
