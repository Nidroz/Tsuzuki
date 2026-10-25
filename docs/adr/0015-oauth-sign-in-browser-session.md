# ADR-0015: OAuth sign-in through a browser auth session

- Status: Proposed
- Date: 2026-10-25

## Context

A-02 adds Google and Apple sign-in (FR-21) on Supabase Auth (ADR-0002), next to the email accounts of A-01 (ADR-0014). Constraints:

- The client already uses `flowType: 'pkce'`, `detectSessionInUrl: false` and `appendPkceFlowIdToRedirects` (ADR-0014): `signInWithOAuth` stores a code verifier in a flow slot of the secure store (`SessionStorage`, a ring of 5 slots) and returns the authorize URL with the flow id, whose `redirect_to` carries `?sb_flow_id=<id>`.
- "A deep link never triggers a write by itself" (`CONTRIBUTING.md` §7). The provider flow ends with a redirect to a `tsuzuki://` URL, which on Android also reaches expo-router as an incoming link.
- `src/core/` stays platform-agnostic (ADR-0006): the browser step is mobile-only.
- Opening a browser session needs a native module the project does not have yet; the owner has not approved the dependency. The provider accounts (a Google Cloud OAuth web client; an Apple Service ID, team id, key id and private key) and the Supabase dashboard settings do not exist yet either.
- GoTrue's `/authorize` answers a 400 JSON page in the browser for a provider not enabled in the project (verified on the local stack). Supabase captcha protection does not cover `/authorize`.
- Supabase links a provider identity to an existing account with the same verified email; an unconfirmed email account with that email is not taken over (the unverified identity is dropped).

Options considered, sign-in mechanism:

- **Native SDKs with `signInWithIdToken`** (a Google Sign-In package, `expo-apple-authentication`): native account pickers, no browser; but one SDK per provider, a non-Expo package for Google, and a nonce and audience setup per platform. The native Apple button may still come with iOS builds.
- **Browser session with Supabase OAuth**: one flow for both providers, no provider SDK, an Expo-maintained module, the same PKCE and flow id handling as the email links. Chosen.

Options considered, browser step:

- **`Linking.openURL` and a URL listener**: no dependency, but the user leaves the app for the system browser, there is no signal when they give up, and it reimplements what an auth session does. Rejected.
- **`expo-web-browser` `openAuthSessionAsync`**: ASWebAuthenticationSession on iOS (the session captures the redirect itself), Custom Tabs on Android; resolves with the redirect URL or a cancel. Chosen, behind a core port (`OAuthBrowser`).

Options considered, when the code is exchanged:

- **On route open** (`auth/oauth-callback` exchanges its params): works on a cold start, but opening a link would write a session (against `CONTRIBUTING.md` §7), and any app could open the route with its own code. Rejected.
- **In the hook, from the session result**: the exchange is part of the user's tap on "Continue with Google", and only the URL the session this call opened returned is ever exchanged. Chosen.

Options considered, which buttons are shown:

- **Always both**: a provider the project has not enabled sends the user to GoTrue's 400 JSON page.
- **A per-build provider list** (`oauthProviders`): a button only for a provider the build declares, empty until everything is wired. Chosen.

## Decision

- Core declares the port next to the captcha seam, in `src/core/repositories/auth-repository.ts`: `OAuthBrowser.openAuthSession(url, redirectUrl): Promise<OAuthBrowserResult>`, `OAuthBrowserResult = { type: 'redirect'; url } | { type: 'closed' }`. Its implementation over `expo-web-browser` lives in `src/platform/` and comes with A-09, with the dependency.
- `OAUTH_PROVIDERS = ['google', 'apple']`, `OAuthProvider`. `AuthRepository` gains `oauthProviders` (the providers this build can sign in with, `[]` until A-09) and `signInWithProvider(provider): Promise<AuthSession | null>`.
- Flow: `signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } })` gives `{ url, flowId }`; the repository opens `url` with `OAuthBrowser`, parses the returned redirect `tsuzuki://auth/oauth-callback?sb_flow_id=…&code=…` (or `error`, `error_code`, `error_description`, in the query or the fragment) with Zod in core, checks that its flow id equals the one `signInWithOAuth` returned, else fails without exchanging, then calls `exchangeCodeForSession(code, { flowId })`.
- Outcomes: the session; `null` when the user closed the browser or declined consent (`error=access_denied` without an `error_code`; Supabase's own refusals carry one and fail); `oauth-failed` (a new `AuthErrorReason`) for a failed or mismatched redirect and a failed exchange; `network` when the exchange lost the connection; `unknown` for a provider outside `oauthProviders` or a browser session that cannot start. No captcha. `error_description` is never shown or logged.
- `createSupabaseAuthRepository` takes an optional `oauth: { browser, providers, redirectUrl }`; without it `oauthProviders` is `[]`. The composition root does not pass it in A-02.
- Redirect path `AUTH_LINK_PATHS.oauth = 'auth/oauth-callback'` (one route per intent, ADR-0014). The route `app/auth/oauth-callback.tsx` exists because Android also hands the redirect to expo-router: its screen never reads or exchanges the params and writes nothing; on mount it goes back once (`router.back()`) when the screen below is sign in or sign up (`OAUTH_SOURCE_ROUTES`, `src/features/auth/auth-routes.ts`), whose hook awaits the result; `canGoBack()` alone is not enough, since a cold deep link gets the tabs below it (`unstable_settings`); otherwise (a cold start after the process was killed in the browser, or a stray link) it shows "sign in did not finish" with a Sign in button. On iOS the session captures the redirect, so the route shows only for stray links.
- Sign in and sign up show plain text buttons "Continue with Google" / "Continue with Apple", one per entry of `oauthProviders`, hidden while it is empty. Branded buttons, the per-build list (`EXPO_PUBLIC_AUTH_PROVIDERS`), the platform implementation, the provider accounts and the dashboard settings are A-09.
- The app keeps the user id only: Apple's private relay email and its name on first sign-in are not read.

## Consequences

- Maintainability: screens and hooks know `AuthRepository`, `OAuthProvider` and nothing of Supabase or the browser module; the redirect format is parsed in one core schema, with the bounds of `parseAuthLinkParams` (bounded code and flow id, repeated params rejected). The repository tests drive the flow with a fake `OAuthBrowser`, without a device. The experimental flow id flag is the one ADR-0014 already depends on. One more route and one more allow list entry per project.
- Security: PKCE plus the flow id binding block login CSRF and code injection: a redirect another app or page fires carries a code issued for another verifier, or a flow id this call did not start, and fails before or at the exchange; a route opened by a link never exchanges. No tokens in any URL (no implicit flow). The browser session shows the real provider page with its address, in the system browser engine, so the app never sees the provider password. No captcha protects `/authorize`; GoTrue's per-IP rate limits apply. Identity linking never takes over an unconfirmed email account.
- Performance: no request before the tap; `signInWithOAuth` builds the URL locally; one exchange request after the redirect. No new dependency in A-02.
- Operations: each project needs the provider settings and the allow list entry `tsuzuki://auth/oauth-callback?sb_flow_id=*` (`ARCHITECTURE.md` §10 step 9), in A-09. The Apple client secret Supabase needs is a JWT signed with the Apple key, valid at most 6 months: it must be regenerated and replaced before it expires, or Apple sign-in stops. Google's consent screen names the project's `supabase.co` host unless the project uses a custom domain. A cancelled or interrupted flow leaves a verifier in the 5-slot ring, evicted by later flows; harmless. A flow cut by the process being killed is not resumed: the user taps again. On iOS, App Store guideline 4.8 requires Apple sign-in next to Google, so an iOS build that declares `google` declares `apple` too, and account deletion (A-06) must then revoke the user's Apple tokens (guideline 5.1.1(v)).
- Web app: same interface. A web `OAuthBrowser` opens a popup and reads its redirect, or the web app passes an https `redirectTo` to its own callback page; that choice belongs to the web app's ADR.
