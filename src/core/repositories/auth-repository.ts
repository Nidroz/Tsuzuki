// the auth repository (docs/ARCHITECTURE.md §4, §8, ADR-0014, ADR-0015, ADR-0018): email accounts
// (A-01) and google and apple sign-in (A-02) on supabase auth (supabase/auth-repository.ts), and
// account deletion through the delete-account edge function (A-06). types, the provider list and
// the disabled captcha only

/** the signed-in user as the app needs it: the id only. no email or token is kept in app state. */
export interface AuthSession {
  readonly userId: string;
}

/** an email and a password, validated by the form schemas (src/core/schemas/auth-forms.ts). */
export interface EmailCredentials {
  readonly email: string;
  readonly password: string;
}

/** the captcha token of a protected call; left out while the captcha is disabled (noCaptcha). */
export interface AuthRequestOptions {
  readonly captchaToken?: string;
}

/**
 * the auth code of a confirmation or recovery link, with the pkce flow id the link carries back
 * (parseAuthLinkParams, src/core/schemas/auth-link-params.ts): the flow id selects the verifier
 * stored on this device when the email was requested.
 */
export interface EmailLinkCode {
  readonly code: string;
  readonly flowId: string;
}

/** the identity providers the app can sign in with (ADR-0015), by their supabase auth names. */
export const OAUTH_PROVIDERS = ['google', 'apple'] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** called with the current session, null when signed out. */
export type AuthSessionListener = (session: AuthSession | null) => void;

/** called with the id of a user the auth server says no longer exists (onUserGone). */
export type UserGoneListener = (userId: string) => void;

/**
 * the account of the current user (FR-21). hooks depend on this interface only
 * (src/core/hooks/AuthContextProvider.tsx); the composition root creates the supabase
 * implementation.
 *
 * every rejection is an AuthError (src/core/errors/auth-errors.ts) whose reason says what the
 * user can do; its message is fixed per reason and never holds an email, a password, a code, a
 * token or a server text. the one exception is `deleteAccount`, which rejects with an
 * AccountDeletionError (src/core/errors/account-deletion-errors.ts) built the same way. calls
 * that send an email resolve the same way whether or not an account exists for that email, so the
 * app never tells which emails are registered.
 */
export interface AuthRepository {
  /**
   * creates an account and sends the confirmation email, whose link opens the confirmation route
   * (AUTH_LINK_PATHS.confirmation). an email already registered resolves the same way.
   */
  signUp(credentials: EmailCredentials, options?: AuthRequestOptions): Promise<void>;

  /** sends the confirmation email again; resolves for an unknown or already confirmed email too. */
  resendConfirmation(email: string, options?: AuthRequestOptions): Promise<void>;

  /** signs in with a confirmed account; an unconfirmed one rejects with `email-not-confirmed`. */
  signIn(credentials: EmailCredentials, options?: AuthRequestOptions): Promise<AuthSession>;

  /**
   * the providers this build can sign in with, in display order: the screens show one button per
   * entry. empty until the browser session and the provider setup are wired (A-09).
   */
  readonly oauthProviders: readonly OAuthProvider[];

  /**
   * signs in with an identity provider (pkce, ADR-0015): opens the provider's consent in a browser
   * auth session (OAuthBrowser), checks that the redirect carries the flow id this call started,
   * then exchanges its code. called only on a user action; a route opened by the redirect never
   * exchanges. resolves null when the user closed the browser or declined consent
   * (`access_denied`). rejects with `oauth-failed` for a failed or mismatched redirect or a failed
   * exchange, `network` when the exchange lost the connection, and `unknown` for a provider not in
   * oauthProviders or a browser session that cannot start. no captcha: supabase does not protect
   * the authorize endpoint.
   */
  signInWithProvider(provider: OAuthProvider): Promise<AuthSession | null>;

  /**
   * sends the recovery email, whose link opens the reset route (AUTH_LINK_PATHS.passwordReset);
   * resolves for an unknown email too.
   */
  requestPasswordReset(email: string, options?: AuthRequestOptions): Promise<void>;

  /**
   * exchanges the code of a confirmation or recovery link for a session (pkce). called only on a
   * user action, never when the link opens (ADR-0014). a code that is expired, already used, or
   * has no verifier on this device rejects with `link-invalid`; so does every other failure (a
   * lost connection, a server error), since a failed exchange consumes the verifier.
   */
  completeEmailLink(link: EmailLinkCode): Promise<AuthSession>;

  /** sets the password of the signed-in user (after the recovery link exchange). */
  updatePassword(newPassword: string): Promise<void>;

  /**
   * signs out on this device only (local scope). resolves once the session is gone from the
   * device, even when the server could not revoke it (offline). an expired session that cannot
   * be refreshed (offline) stays, and the call rejects with `network`.
   *
   * a failure of reason `unknown` is reported by the implementation itself, as `deleteAccount`
   * does, whether the call then rejects or resolves (the session gone after a server failure the
   * implementation cannot classify): callers never report that reason again. the other reasons
   * are not reported.
   */
  signOut(): Promise<void>;

  /**
   * deletes the account of the signed-in user for good (FR-24, ADR-0018): one POST to the
   * delete-account edge function, which checks the session's access token with the auth server and
   * hard deletes that token's user; the database cascades remove the profile, the library entries
   * and the progress events, for every device. a session on this device is required: without one
   * the call rejects with `session-expired` and sends nothing. nothing else is sent: no body, no
   * user id (the function takes the user from the verified token only). resolves once the function
   * answered `{ "deleted": true }`, which it also answers for an account already gone. called only
   * on the user's confirmed tap, never by a link.
   *
   * rejects with an AccountDeletionError, never an AuthError: `network` when no answer came (a
   * fetch error, ACCOUNT_DELETION_TIMEOUT_MS, a 408, 429, 502, 503 or 504: the account may or may
   * not be deleted), and for a session read error (nothing sent); `session-expired` for no session
   * on the device (nothing sent) or a 401 (the token or its user refused); `unknown` for anything
   * else (another status, a relay error, an answer that does not parse), the only reason reported.
   * `offline` is never used here: the hook checks the connection before calling.
   *
   * it neither purges the device nor signs out, whatever the outcome: on success the caller
   * (useDeleteAccount) purges the device data and ends the local session; on failure the user
   * stays signed in and nothing on the device changes.
   */
  deleteAccount(): Promise<void>;

  /**
   * subscribes to the session: the listener is called with the current session right after
   * subscribing (asynchronously), then on every change. the listener is called synchronously and
   * its result is not awaited: it sets state, async work belongs to the hooks. returns the
   * unsubscribe function.
   */
  onAuthStateChange(listener: AuthSessionListener): () => void;

  /** token auto refresh, on only while the app is in the foreground (the composition root). */
  setAutoRefresh(active: boolean): void;

  /**
   * subscribes to the users the auth server says no longer exist (ADR-0018, update of
   * 2026-11-04): an account deleted from another device, or a deletion whose answer was lost.
   * returns the unsubscribe function.
   *
   * what triggers a check: only a token refresh the auth server refused (a 4xx other than 408 and
   * 429), which alone is ambiguous (a revoked session answers the same). the check then reads the
   * session on the device and, when its access token is not expired, asks the auth server for the
   * user of that token. the only signal that reports a user gone is the auth server answering
   * `user_not_found` for that token: the listener then gets the id of that session's user, never
   * any other id. nothing is reported for a success, a revoked session (`session_not_found`, whose
   * session the auth client then removes itself), an invalid or expired token, any other error
   * code, a server error, a lost connection, no session, or an expired access token (no request
   * sent). a refused refresh while the access token already expired is never checked. at most one
   * check runs at a time: a refusal during a check starts none.
   *
   * delivery: every subscribed listener is called synchronously, in subscription order, with each
   * detection; a listener must not throw (a throw is reported as `unknown` and the others are
   * still called). a detection while no listener is subscribed is kept (the most recent ids, a few
   * at most, each once) and delivered once, asynchronously, to the next listener that subscribes,
   * then forgotten. a later refusal for a session still on the device may report the same id
   * again: listeners treat a repeat as a no-op.
   *
   * it never signs out, purges or changes anything on the device by itself: the hooks decide
   * (write the purge-pending marker, end the session, purge the device). nothing is reported to
   * the error reporter for the expected outcomes; an unexpected throw of the check is reported as
   * an AuthError `unknown`, under its operation only.
   */
  onUserGone(listener: UserGoneListener): () => void;
}

/** the auth calls a captcha protects (supabase captcha protection). */
export type CaptchaAction = 'sign-up' | 'sign-in' | 'password-reset' | 'resend-confirmation';

/**
 * the captcha seam (ADR-0014): the auth hooks ask for a token before each protected call and pass
 * it as `captchaToken`. null means the captcha is disabled; a cancelled or failed challenge
 * rejects with an AuthError `captcha-failed`.
 */
export interface CaptchaTokenProvider {
  getToken(action: CaptchaAction): Promise<string | null>;
}

/** the captcha provider until one is wired (A-08): every call goes without a token. */
export const noCaptcha: CaptchaTokenProvider = {
  getToken: () => Promise.resolve(null),
};

/** how a browser auth session ended: the redirect it captured (untrusted), or closed by the user. */
export type OAuthBrowserResult =
  { readonly type: 'redirect'; readonly url: string } | { readonly type: 'closed' };

/**
 * the browser auth session port (ADR-0015), implemented in src/platform/ (A-09): opens `url` in a
 * session the app controls (ASWebAuthenticationSession on ios, custom tabs on android) and resolves
 * with the first url that starts with `redirectUrl`, or `closed` when the user closes it. rejects
 * only when no session can start (another one open, no browser).
 */
export interface OAuthBrowser {
  openAuthSession(url: string, redirectUrl: string): Promise<OAuthBrowserResult>;
}
