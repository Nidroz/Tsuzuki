# ADR-0014: Email auth links and the captcha seam

- Status: Accepted
- Date: 2026-10-22

## Context

A-01 adds email accounts on Supabase Auth (ADR-0002, FR-21): sign up with a required email confirmation, resend of the confirmation email, sign in, and password reset. Two of these flows leave the app: Supabase sends an email whose link points to its `/verify` endpoint, which checks the one-time token server side, then redirects to a URL the app chose (`redirect_to`). Constraints:

- The client already uses `flowType: 'pkce'` and `detectSessionInUrl: false` (`ARCHITECTURE.md` §8): the app parses its own deep links with Zod.
- "A deep link never triggers a write by itself" (`CONTRIBUTING.md` §7). Exchanging a code for a session writes the session to the device and signs the user in.
- With PKCE, supabase-js stores a code verifier on the device when the email is requested (`SessionStorage`, the secure store) and needs it to exchange the code. supabase-js 2.117 keeps one verifier slot per flow (at most 5), plus a legacy key mirroring the latest flow. Without a flow id, the exchange uses the legacy key; a link from an older request (an email resent, a second reset request) then submits the wrong verifier, burns its single-use code and deletes the legacy key, so the newest link fails too. The opt-in `auth.experimental.appendPkceFlowIdToRedirects` appends `sb_flow_id` to `redirect_to`, so each link carries its own flow id and selects its own slot.
- Supabase's PKCE redirect does not say which email it comes from: the type is only known after the exchange (`redirectType`), i.e. after the write.
- The backlog asks for a captcha on the auth endpoints (`ARCHITECTURE.md` §9). Supabase supports hCaptcha and Turnstile; both need an external account, a site key and a secret, and a WebView-based widget on React Native (a new native dependency). The owner has not chosen a provider.
- The app has no web domain yet, so no verified https links (Android App Links, iOS Universal Links).

Options considered, flow type:

- **Implicit**: the redirect carries the access and refresh tokens in the URL fragment. Tokens in a URL can leak (other apps registered for the scheme, logs), and any app can hand the app a session it did not request (login CSRF). Rejected.
- **PKCE**: the redirect carries a single-use code, useless without the verifier stored on this device. Chosen (already configured).

Options considered, verifier correlation:

- **Legacy single key**: no configuration, but pending flows interfere as described above.
- **Flow id in the redirect (`appendPkceFlowIdToRedirects`)**: each link selects its own verifier; the flag is marked experimental and the redirect allow list must accept the extra query parameter. Chosen.

Options considered, when the code is exchanged:

- **On open**: one tap less, but opening a link writes a session (against `CONTRIBUTING.md` §7), a link received from someone else would sign the device into their flow if a verifier matched, and a recovery link would sign the user in before they chose a new password.
- **On a user action**: the confirmation screen exchanges on Continue, the reset screen on submit of a valid new password. Chosen.

Options considered, routes:

- **One callback route for both emails**: one redirect URL, but the screen cannot tell a confirmation from a recovery before the exchange, so it cannot show the right form without writing first.
- **One route per email**: `auth/callback` (confirmation) and `auth/reset-password` (recovery); the path states the intent before any write. Chosen.

Options considered, link transport:

- **Custom scheme `tsuzuki://`**: works today; any app can register the same scheme, which PKCE makes harmless (a stolen code is useless without the verifier).
- **Verified https links**: no scheme hijacking and better mail client support, but they need a domain, hosted association files and a page for devices without the app. Deferred.

Options considered, captcha:

- **Wire hCaptcha or Turnstile now**: blocks A-01 on an owner choice, an external account and a WebView dependency.
- **Ship a provider-agnostic seam, disabled by default**: `CaptchaTokenProvider.getToken(action)` returns a token or null, the hooks pass it to the four protected calls, `noCaptcha` until a provider is wired (A-08). Chosen.

## Decision

- Email links use PKCE with `appendPkceFlowIdToRedirects` on. The confirmation email redirects to `tsuzuki://auth/callback`, the recovery email to `tsuzuki://auth/reset-password`, each followed by `?sb_flow_id=<id>` and then Supabase's `code` or its `error` / `error_code` / `error_description`. The scheme and paths have one source of truth in core (`APP_SCHEME`, `AUTH_LINK_PATHS`), read by `app.config.ts` and given by the composition root to `createSupabaseAuthRepository` as full redirect URLs.
- Link params are parsed with Zod (`parseAuthLinkParams`): a bounded code and flow id, arrays rejected, `otp_expired` read as expired, any other error or shape as invalid; `error_description` is never shown or logged.
- No exchange on open. The confirmation screen shows "email confirmed" (the server has already confirmed it) and exchanges on Continue; a failed exchange offers sign in. The reset screen validates the new password first, then exchanges and updates the password on submit; a retry after a failed update does not exchange again.
- The `AuthRepository` interface (`src/core/repositories/auth-repository.ts`) holds the A-01 calls; rejections are `AuthError` with a fixed reason. Sign out is local (this device), and token auto refresh runs only while the app is in the foreground.
- Captcha: the seam above, `noCaptcha` by default. Wiring a provider (A-08) adds a `CaptchaTokenProvider` implementation, a site key in the app env and the server secret; no interface change.

## Consequences

- Maintainability: the screens, hooks and schemas know an `AuthRepository`, an `EmailLinkCode` and a `CaptchaTokenProvider`, never Supabase. The Supabase link format (`code`, `sb_flow_id`, `error_code`) is parsed in one core schema. The experimental flag may change in a supabase-js update: the repository tests assert that the redirect URLs sent carry `sb_flow_id`, and M-01 reads the auth-js changelog. Two routes and two allow list entries per project instead of one.
- Security: no session is created by opening a link, and recovery links never sign the user in before a new password is chosen. A code is useless on another device or app (PKCE), which also blocks login CSRF; the screen then offers sign in, since the email is already confirmed server side. Sign up, resend and reset resolve the same way for known and unknown emails, with one Supabase exception: a second email within `max_frequency` (60 s) for an existing account is rate limited, a narrow enumeration signal bounded by the rate limits and, later, the captcha. Until A-08, credential stuffing and email bombing are bounded only by Supabase's per-IP rate limits. Errors carry a reason only; nothing personal reaches Sentry.
- Performance: no new dependency in A-01; the auto refresh timer stops in the background.
- Operations: each hosted project needs the redirect allow list, the password policy, email confirmations and a custom SMTP sender (`ARCHITECTURE.md` §10). A link opened on a device without the pending verifier (another phone, the app reinstalled, the verifier evicted after 5 newer requests) fails as `link-invalid`; the email of a confirmation is confirmed anyway. A failed exchange, a lost connection or a server error included, consumes the verifier (supabase-js deletes it on every failure), so the link becomes `link-invalid` and cannot be retried: the confirmation screen then says the email is confirmed and offers sign in; the reset screen offers a new link. All variants share the `tsuzuki` scheme, so with two variants installed Android may ask which app opens a link, and the wrong one fails as `link-invalid`. Mail link scanners that follow links consume the single-use token. Enabling the captcha on a project makes older binaries without a provider fail every protected call, so the server side is switched on only once the binaries in use send tokens.
- Web app: the interface, schemas, hooks and captcha seam are platform-agnostic. A web app passes https redirect URLs to the same factory, reads the flow id from its own callback URL, and implements `CaptchaTokenProvider` with the provider's browser widget.
