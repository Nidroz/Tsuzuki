import { z } from 'zod';

import type { EmailLinkCode } from '../repositories/auth-repository';

// the params of an auth email link (docs/ARCHITECTURE.md §8, ADR-0014) are untrusted input
// (CONTRIBUTING.md §7): supabase redirects to the app with `sb_flow_id` and either `code` or
// `error` / `error_code` / `error_description`, and any app or page can open the same url.
// parsing never writes, and error_description is never read: it is server text

/** the longest auth code accepted (supabase issues uuids, 36 characters). */
export const AUTH_CODE_MAX_LENGTH = 128;

/** the query param carrying the pkce flow id (supabase-js appendPkceFlowIdToRedirects). */
export const AUTH_FLOW_ID_PARAM = 'sb_flow_id';

const AUTH_CODE_PATTERN = /^[A-Za-z0-9-]+$/;
// the flow id check of supabase-js (validatePKCEFlowId): a flow id selects a storage key
const FLOW_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
// the supabase error code of an expired or already used email link token
const EXPIRED_ERROR_CODE = 'otp_expired';

/** what an auth email link holds: a code to exchange, or why the link failed. */
export type AuthLinkParams =
  | { readonly kind: 'code'; readonly link: EmailLinkCode }
  | { readonly kind: 'failed'; readonly reason: 'expired' | 'invalid' };

const INVALID_LINK: AuthLinkParams = { kind: 'failed', reason: 'invalid' };

// a plain object of params (arrays and primitives fail), read for its error params only
const linkErrorSchema = z.object({
  error: z.unknown().optional(),
  error_code: z.unknown().optional(),
});

// a repeated param arrives as an array and fails the string schemas
const linkCodeSchema = z
  .object({
    code: z.string().max(AUTH_CODE_MAX_LENGTH, { abort: true }).regex(AUTH_CODE_PATTERN),
    [AUTH_FLOW_ID_PARAM]: z.string().regex(FLOW_ID_PATTERN),
  })
  .transform((params): EmailLinkCode => ({
    code: params.code,
    flowId: params[AUTH_FLOW_ID_PARAM],
  }));

/**
 * parses the route params of an auth email link (expo-router's useLocalSearchParams). an `error`
 * or `error_code` fails the link, even next to a code: `expired` for an expired token, `invalid`
 * otherwise. a code with a valid flow id gives the link to exchange; anything else is `invalid`.
 */
export const parseAuthLinkParams = (raw: unknown): AuthLinkParams => {
  const errorParams = linkErrorSchema.safeParse(raw);
  if (!errorParams.success) {
    return INVALID_LINK;
  }
  const { error, error_code: errorCode } = errorParams.data;
  if (error !== undefined || errorCode !== undefined) {
    return { kind: 'failed', reason: errorCode === EXPIRED_ERROR_CODE ? 'expired' : 'invalid' };
  }
  const link = linkCodeSchema.safeParse(raw);
  return link.success ? { kind: 'code', link: link.data } : INVALID_LINK;
};
