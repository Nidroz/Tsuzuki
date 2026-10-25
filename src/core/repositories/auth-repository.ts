// the auth repository (docs/ARCHITECTURE.md §4, §8, ADR-0014, ADR-0015): email accounts (A-01) and
// google and apple sign-in (A-02) on supabase auth (supabase/auth-repository.ts); account deletion
// comes with A-06. types, the provider list and the disabled captcha only

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

/**
 * the account of the current user (FR-21). hooks depend on this interface only
 * (src/core/hooks/AuthContextProvider.tsx); the composition root creates the supabase
 * implementation.
 *
 * every rejection is an AuthError (src/core/errors/auth-errors.ts) whose reason says what the
 * user can do; its message is fixed per reason and never holds an email, a password, a code, a
 * token or a server text. calls that send an email resolve the same way whether or not an account
 * exists for that email, so the app never tells which emails are registered.
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
   */
  signOut(): Promise<void>;

  /**
   * subscribes to the session: the listener is called with the current session right after
   * subscribing (asynchronously), then on every change. the listener is called synchronously and
   * its result is not awaited: it sets state, async work belongs to the hooks. returns the
   * unsubscribe function.
   */
  onAuthStateChange(listener: AuthSessionListener): () => void;

  /** token auto refresh, on only while the app is in the foreground (the composition root). */
  setAutoRefresh(active: boolean): void;
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
