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

## Update (2026-11-15)

From the security follow-ups (R-09, `docs/security-review.md`). The text above is kept as accepted; where they differ, this section applies.

### Secure random source and S256 challenge

Before this, on Hermes (React Native 0.86, Expo SDK 57), which installs neither `crypto.getRandomValues` nor `crypto.subtle`, auth-js drew the PKCE verifier and the flow id from `Math.random` and sent the verifier itself as a `plain` challenge (MASVS-CRYPTO-1, MASVS-AUTH-1). With `plain`, "a stolen code is useless without the verifier" (Options, link transport) held only while the authorize request stayed unseen, the OAuth URL opened in the browser included.

- `expo-crypto` 57.0.4: MIT, Expo-maintained, 373,103 bytes unpacked with its native sources, only peer `expo`. Its generator is the platform's: `SecRandomCopyBytes` on iOS (`ios/CryptoModule.swift`), `java.security.SecureRandom` on Android (`CryptoModule.kt`). Lint confines it to `src/platform/` (`tools/eslint/import-bans.mjs`, cases in `tools/eslint/layers-platform-only-cases.mjs`). This replaces "no new dependency in A-01" (Consequences, Performance) from R-09 on.
- `installWebCrypto(target)` (`src/platform/web-crypto.ts`) installs on the target only the members it lacks (`crypto`, `getRandomValues`, `subtle`, `subtle.digest`), member by member, never replacing an engine's own implementation, once per target (a second call adds nothing). A target that cannot take a member (frozen) fails the launch instead of leaving `Math.random` to auth-js.
- `getRandomValues` keeps the Web Crypto contract, checked before any byte is drawn: a `TypeError` for anything but an `ArrayBufferView`, integer typed arrays only (`TypeMismatchError`), at most 65,536 bytes per call (`QuotaExceededError`); both names are set on plain `Error`s, React Native has no `DOMException`. `subtle.digest` supports SHA-256 only and rejects any other algorithm with `NotSupportedError`. No other `subtle` member: only what the app's libraries call.
- `src/platform/web-crypto-polyfill.ts` runs it on `globalThis` and is the first import of `app/_layout.tsx`, so both members exist before `createSupabaseClient` draws a verifier and before the app storage key is drawn. `secureRandomValues`, the key source of ADR-0020, is the same function as the installed `getRandomValues`.

### What auth-js 2.117.3 checks

`@supabase/auth-js/dist/module/lib/helpers.js`:

- `generatePKCEVerifier` (line 206): `Math.random` (209-216) when `typeof crypto === 'undefined'`, else `crypto.getRandomValues(new Uint32Array(56))` (218).
- `generatePKCEChallenge` (230) needs `crypto`, `crypto.subtle` and `TextEncoder` (231-233); without them it warns "WebCrypto API is not supported" (235) and returns the verifier. Otherwise `sha256` (221) hashes through `crypto.subtle.digest('SHA-256', …)` (224) and the result is encoded with `btoa` (239).
- `generatePKCEFlowId` (250) fills a `Uint8Array(16)` (252-253) when `typeof crypto.getRandomValues === 'function'` (251), else draws from `Math.random` (258).
- `getCodeChallengeAndMethod` (388) sends `plain` when the challenge equals the verifier, `s256` otherwise (397).

The integration test below runs this auth-js through the app's `createSupabaseClient`, so an update that brings back `plain` or `Math.random` under the binding fails it; M-01 still rereads these lines. Device assumption to confirm on the preview build (R-07): Hermes has `TextEncoder` and `btoa`.

### `getClaims`

`GoTrueClient.getClaims` (`GoTrueClient.js` line 5512) verifies an asymmetric JWT locally once `'subtle' in globalThis.crypto` (5536), through `crypto.subtle.importKey` (5557) and `verify` (5561); a symmetric JWT falls back to `getUser`. The binding has a `subtle` without `importKey`, so such a call would throw. The app never calls `getClaims`; a future call needs `importKey` and `verify` in the binding first.

### Tests

- `src/platform/web-crypto.test.ts`: the contract above (arrays, bounds, error names, SHA-256 only, members kept, once per target), and `secureRandomValues` as the binding's `getRandomValues`.
- `src/platform/web-crypto-polyfill.test.ts`: both members installed on expo-crypto, one binding when evaluated twice, a native crypto untouched.
- `test/mobile/pkce-web-crypto.test.ts`, on an engine without crypto and with the binding: sign up and password reset send `s256` with challenge = base64url(SHA-256(verifier)) of the stored verifier, the OAuth authorize URL carries it, the verifier and the flow id come from expo-crypto, no `Math.random` call and no warning. Control case without the binding: `plain`, the challenge equal to the verifier, `Math.random` called once per verifier character and flow id digit.
- `test/app/root-layout-app-storage.test.tsx`: the binding installed once, before `createSupabaseClient`.

### Release

`runtimeVersion` uses the `appVersion` policy (`app.config.ts`): an EAS update of this JavaScript reaching a binary of the same version built without the ExpoCrypto native module would crash at launch. The change ships with new builds only; no update targets older binaries.
