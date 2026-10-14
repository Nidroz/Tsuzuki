// the jikan v4 compatible instances the adapter can query: tenrai by default, or a self-hosted
// jikan named by the app env. every instance serves the same schema and the same mal ids, so the
// instance never changes a media key; it only sets the base url and the rate limit
import type { MediaIdNamespace } from '../../domain/media';
import type { RateLimitPolicy } from '../http/rate-limiter';
import { SELF_HOSTED_JIKAN_RATE_LIMIT, TENRAI_RATE_LIMIT } from './jikan-rate-limit';

/** the id namespace of every jikan v4 instance: MyAnimeList ids. */
export const JIKAN_NAMESPACE = 'mal' as const satisfies MediaIdNamespace;

/** a jikan v4 compatible server: its short id, its root url (https, no trailing slash) and limit. */
export interface JikanInstance {
  readonly id: string;
  readonly baseUrl: string;
  readonly rateLimit: RateLimitPolicy;
}

/** the default instance, tenrai: the jikan v4 schema unchanged, covers on the mal cdn. */
export const TENRAI_INSTANCE: JikanInstance = {
  id: 'tenrai',
  baseUrl: 'https://api.tenrai.org/v1',
  rateLimit: TENRAI_RATE_LIMIT,
};

/** the instance id of every self-hosted jikan: never its url, which may name a private host. */
export const SELF_HOSTED_JIKAN_ID = 'jikan-self-hosted';

const HTTPS_PREFIX = 'https://';
const TRAILING_SLASH = '/';

/**
 * a self-hosted jikan v4 instance at `baseUrl`, with the conservative rate limit. `baseUrl` comes
 * parsed from the app env; a url that is not https or ends with a slash is a RangeError, without
 * the url in its message.
 */
export const selfHostedJikanInstance = (baseUrl: string): JikanInstance => {
  if (!baseUrl.startsWith(HTTPS_PREFIX) || baseUrl.endsWith(TRAILING_SLASH)) {
    throw new RangeError('A jikan instance url must be https, without a trailing slash');
  }
  return { id: SELF_HOSTED_JIKAN_ID, baseUrl, rateLimit: SELF_HOSTED_JIKAN_RATE_LIMIT };
};

/** the instance of the app env's `jikanBaseUrl`: tenrai when it is absent, else a self-hosted one. */
export const jikanInstanceFor = (baseUrl: string | undefined): JikanInstance =>
  baseUrl === undefined ? TENRAI_INSTANCE : selfHostedJikanInstance(baseUrl);
