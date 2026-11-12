/**
 * installs the web crypto binding of web-crypto.ts on globalThis where the engine lacks it, as
 * hermes does. side effects only, imported first by the root layout: crypto.getRandomValues and
 * crypto.subtle.digest exist before the supabase client draws a pkce verifier (s256 from a secure
 * source, never Math.random and plain) and before the app storage key is drawn. a no-op where the
 * engine has them, and on a second evaluation
 */
import { installWebCrypto } from './web-crypto';

installWebCrypto(globalThis);
