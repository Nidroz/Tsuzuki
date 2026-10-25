import type { EmailLinkCode } from '../repositories/auth-repository';
import { AUTH_FLOW_ID_PARAM, authLinkCodeSchema } from './auth-link-params';

// the redirect a provider sign in ends with (docs/ARCHITECTURE.md §8, ADR-0015) is untrusted input
// (CONTRIBUTING.md §7): the browser session hands back the first url that starts with the redirect
// url, whichever page sent it. supabase redirects with `sb_flow_id` and either `code` or `error` /
// `error_code` / `error_description`. plain string rules, not the react native URL polyfill, so jest
// and the device read a url the same way (docs/ARCHITECTURE.md §9). parsing never writes, and
// error_description is never read: it is server text

/** the longest redirect url accepted. */
export const OAUTH_REDIRECT_MAX_LENGTH = 2048;

/** what a provider sign in redirect holds: a code to exchange, a declined consent, or a failure. */
export type OAuthRedirect =
  | { readonly kind: 'code'; readonly link: EmailLinkCode }
  | { readonly kind: 'declined' }
  | { readonly kind: 'failed' };

const FAILED: OAuthRedirect = { kind: 'failed' };
const DECLINED: OAuthRedirect = { kind: 'declined' };

const QUERY_START = '?';
const FRAGMENT_START = '#';
const PARAM_SEPARATOR = '&';
const VALUE_SEPARATOR = '=';
const CODE_PARAM = 'code';
const ERROR_PARAM = 'error';
const ERROR_CODE_PARAM = 'error_code';
// the provider's answer to a declined consent, passed on by supabase without an error_code; supabase
// also sends it with an error_code for its own refusals (signups disabled, a banned user)
const DECLINED_ERROR = 'access_denied';

// a malformed escape gives null
const decode = (text: string): string | null => {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
};

// the params of the query and the fragment, keys and values decoded (a `+` stays a `+`); null when
// one does not decode, or a key repeats, within a part or across both
const readParams = (parts: readonly string[]): ReadonlyMap<string, string> | null => {
  const params = new Map<string, string>();
  for (const part of parts) {
    for (const pair of part.split(PARAM_SEPARATOR)) {
      if (pair === '') {
        continue;
      }
      const separator = pair.indexOf(VALUE_SEPARATOR);
      const key = decode(separator === -1 ? pair : pair.slice(0, separator));
      const value = decode(separator === -1 ? '' : pair.slice(separator + 1));
      if (key === null || value === null || params.has(key)) {
        return null;
      }
      params.set(key, value);
    }
  }
  return params;
};

/**
 * parses the url a provider sign in redirected to. it must be at most OAUTH_REDIRECT_MAX_LENGTH
 * characters and start with exactly `redirectUrl`, followed by `?` or `#`; its params are read from
 * the query and the fragment. an `error` or `error_code` wins over a code: `access_denied` without an
 * error_code is `declined`, any other error `failed`. a code with its flow id, within the bounds of
 * parseAuthLinkParams, gives the code to exchange; anything else is `failed`. the caller still
 * checks that the flow id is the one its own flow started.
 */
export const parseOAuthRedirect = (url: string, redirectUrl: string): OAuthRedirect => {
  if (url.length > OAUTH_REDIRECT_MAX_LENGTH || !url.startsWith(redirectUrl)) {
    return FAILED;
  }
  const rest = url.slice(redirectUrl.length);
  if (!rest.startsWith(QUERY_START) && !rest.startsWith(FRAGMENT_START)) {
    return FAILED;
  }
  // the fragment starts at the first `#`, at 0 when there is no query
  const fragmentAt = rest.indexOf(FRAGMENT_START);
  const query = fragmentAt === -1 ? rest.slice(1) : rest.slice(1, fragmentAt);
  const fragment = fragmentAt === -1 ? '' : rest.slice(fragmentAt + 1);
  const params = readParams([query, fragment]);
  if (params === null) {
    return FAILED;
  }
  const error = params.get(ERROR_PARAM);
  const errorCode = params.get(ERROR_CODE_PARAM);
  if (error !== undefined || errorCode !== undefined) {
    return error === DECLINED_ERROR && errorCode === undefined ? DECLINED : FAILED;
  }
  const link = authLinkCodeSchema.safeParse({
    [CODE_PARAM]: params.get(CODE_PARAM),
    [AUTH_FLOW_ID_PARAM]: params.get(AUTH_FLOW_ID_PARAM),
  });
  return link.success ? { kind: 'code', link: link.data } : FAILED;
};
