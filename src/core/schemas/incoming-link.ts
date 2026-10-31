// the size limits of an incoming link (a link the system opens the app with), checked by
// app/+native-intent.tsx before expo-router parses it. expo-router decodes the query with
// query-string 7 and decode-uri-component 0.2, which is quadratic on long runs of percent-encoded
// bytes (GHSA-qr28-fpjm-wq7f); the patched decoder is ESM only, which query-string 7 cannot
// require. the app's own links (media, auth) stay far below both limits

/** the longest incoming link accepted, in UTF-16 code units. */
export const INCOMING_LINK_MAX_LENGTH = 2048;

/** the most percent-encoded bytes (`%` and two hex digits) an incoming link may hold. */
export const INCOMING_LINK_MAX_PERCENT_ESCAPES = 64;

const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/g;

/** whether an incoming link is within both limits, so the router may parse it. */
export const isIncomingLinkWithinLimits = (url: string): boolean => {
  // the length first: the escapes are only counted on a bounded string
  if (url.length > INCOMING_LINK_MAX_LENGTH) {
    return false;
  }
  return (url.match(PERCENT_ESCAPE)?.length ?? 0) <= INCOMING_LINK_MAX_PERCENT_ESCAPES;
};
