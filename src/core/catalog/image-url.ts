// image urls from a provider payload are untrusted input: only an https url on one of the
// provider's cdn hosts is kept. plain string checks, no url parser: react native's URL polyfill
// lacks hostname, so jest and the device would read the same url differently
import { MEDIA_IMAGE_URL_MAX_LENGTH } from '../domain/database-limits';

/**
 * the longest image url kept: the database bound of library_entries.media_image_url. a kept url is
 * ascii only, so its utf-16 length is its code point length.
 */
export const IMAGE_URL_MAX_LENGTH = MEDIA_IMAGE_URL_MAX_LENGTH;

const HTTPS_PREFIX = 'https://';
const PATH_START = '/';
const QUERY_START = '?';
const NOT_FOUND = -1;

// a lowercase dns name: no userinfo, no port, no trailing dot
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
// unreserved characters, slashes and percent escapes of two hex digits; no bare `%`,
// whitespace, backslash, fragment or control character
const PATH_PATTERN = /^\/(?:[A-Za-z0-9\-._~/]|%[0-9A-Fa-f]{2})*$/;
// the path characters plus the key=value separators
const QUERY_PATTERN = /^(?:[A-Za-z0-9\-._~/=&]|%[0-9A-Fa-f]{2})*$/;

const isSafePathAndQuery = (pathAndQuery: string): boolean => {
  const queryStart = pathAndQuery.indexOf(QUERY_START);
  if (queryStart === NOT_FOUND) {
    return PATH_PATTERN.test(pathAndQuery);
  }
  return (
    PATH_PATTERN.test(pathAndQuery.slice(0, queryStart)) &&
    QUERY_PATTERN.test(pathAndQuery.slice(queryStart + 1))
  );
};

/**
 * returns `value` when it is an https url of at most `IMAGE_URL_MAX_LENGTH` characters whose
 * authority is exactly one of `allowedHosts` (lowercase, no userinfo, no port), followed by a path
 * and an optional query from a safe character set; anything else gives null.
 */
export const toAllowedImageUrl = (
  value: unknown,
  allowedHosts: readonly string[],
): string | null => {
  if (
    typeof value !== 'string' ||
    value.length > IMAGE_URL_MAX_LENGTH ||
    !value.startsWith(HTTPS_PREFIX)
  ) {
    return null;
  }
  const rest = value.slice(HTTPS_PREFIX.length);
  const pathStart = rest.indexOf(PATH_START);
  if (pathStart === NOT_FOUND) {
    return null;
  }
  const host = rest.slice(0, pathStart);
  if (!HOST_PATTERN.test(host) || !allowedHosts.includes(host)) {
    return null;
  }
  return isSafePathAndQuery(rest.slice(pathStart)) ? value : null;
};
