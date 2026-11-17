/**
 * installs the web crypto binding of web-crypto.ts on globalThis where the engine lacks it, as
 * hermes does. side effects only, imported first by the root layout: crypto.getRandomValues and
 * crypto.subtle.digest exist before the supabase client draws a pkce verifier (s256 from a secure
 * source, never Math.random and plain) and before the app storage key is drawn. a no-op where the
 * engine has them, and on a second evaluation. then every s256 prerequisite of auth-js is checked
 * (crypto.getRandomValues, crypto.subtle.digest, TextEncoder, btoa): one missing throws a fixed
 * error and fails the launch, where auth-js would silently fall back to the plain challenge
 */
import { assertPkceS256Prerequisites, installWebCrypto } from './web-crypto';

installWebCrypto(globalThis);
assertPkceS256Prerequisites(globalThis);
