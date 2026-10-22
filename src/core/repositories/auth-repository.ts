// the auth repository (docs/ARCHITECTURE.md §4, §8, ADR-0014): email accounts on supabase auth
// (supabase/auth-repository.ts, A-01). google and apple sign-in come with A-02, account deletion
// with A-06. types and the disabled captcha only

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
   * sends the recovery email, whose link opens the reset route (AUTH_LINK_PATHS.passwordReset);
   * resolves for an unknown email too.
   */
  requestPasswordReset(email: string, options?: AuthRequestOptions): Promise<void>;

  /**
   * exchanges the code of a confirmation or recovery link for a session (pkce). called only on a
   * user action, never when the link opens (ADR-0014). a code that is expired, already used, or
   * has no verifier on this device rejects with `link-invalid`.
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
   * subscribing (asynchronously), then on every change. a listener must not await a repository
   * call. returns the unsubscribe function.
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
