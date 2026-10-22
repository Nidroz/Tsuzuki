// the paths of the auth screens (app/auth/) and where a completed flow returns: the settings tab,
// whose account section shows the signed-in state (docs/ARCHITECTURE.md §8)

export const AUTH_PATHS = {
  signIn: '/auth/sign-in',
  signUp: '/auth/sign-up',
  forgotPassword: '/auth/forgot-password',
} as const;

/** the settings tab: every completed auth flow returns there with router.dismissTo */
export const SETTINGS_PATH = '/settings';
