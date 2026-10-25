// the app's own links (docs/ARCHITECTURE.md §8, ADR-0014): one source of truth for the url scheme,
// read by app.config.ts, and for the paths of the auth email links, given as full redirect urls to
// the auth repository by the composition root. no import: app.config.ts loads this file at build time

/** the custom url scheme of every variant. */
export const APP_SCHEME = 'tsuzuki';

/** the routes the auth email links open: one per email, so the path states its intent. */
export const AUTH_LINK_PATHS = {
  confirmation: 'auth/callback',
  passwordReset: 'auth/reset-password',
} as const;

export type AuthLinkPath = (typeof AUTH_LINK_PATHS)[keyof typeof AUTH_LINK_PATHS];

/** the full app url of `path`: `tsuzuki://auth/callback`. */
export const appLinkUrl = (path: AuthLinkPath): string => `${APP_SCHEME}://${path}`;
