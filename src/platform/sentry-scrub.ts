import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';

// personal data never leaves the device (CONTRIBUTING.md section 7, ADR-0012): these pure
// functions run as sentry's beforeSend and beforeBreadcrumb on every event and breadcrumb

// a key containing one of these words anywhere has its value dropped (compared lowercased, without
// - and _): auth and cookie headers, api keys, tokens, passwords, contact fields and the user's
// notes, e.g. userNotes, X-Refresh-Token, set-cookie
const SENSITIVE_KEY_PARTS = [
  'authorization',
  'cookie',
  'apikey',
  'token',
  'password',
  'secret',
  'email',
  'note',
];

// keys dropped only as a whole: too short or too common to look for inside other keys
const SENSITIVE_KEYS = new Set(['session', 'phone']);

// keys holding a url: the query string and the fragment are dropped, they can carry tokens
const URL_KEYS = new Set(['url', 'from', 'to']);

// request parts that are never sent: bodies, cookies and query strings
const DROPPED_REQUEST_KEYS = new Set(['data', 'cookies', 'query_string']);

// deeper values are dropped: an event is never that deep, a cycle would be
const MAX_DEPTH = 12;

const FILTERED = '[Filtered]';

// a postgres constraint error quotes the whole row, notes included: everything after it goes
const FAILING_ROW = /\bfailing row contains\b.*/gis;

// a json string member embedded in a text, e.g. {"notes":"..."}: the key is checked in code. the
// two branches of the value never match the same character, so a failed match backtracks linearly
const JSON_STRING_MEMBER = /"([\w-]{1,64})"(\s*:\s*)"(?:[^"\\]|\\[\s\S])*"/g;

// patterns replaced inside any string (messages, exception values, breadcrumb data). every
// repetition is bounded or followed by a distinct character: no catastrophic backtracking
const TEXT_REPLACEMENTS: readonly (readonly [RegExp, string])[] = [
  // jwts first: a token in a bearer header is replaced whole
  [/\beyJ[\w-]*\.[\w-]+\.[\w-]*/g, '[jwt]'],
  [/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer [token]'],
  // basic credentials: base64 holding a digit, + / or =, so the word basic in a sentence stays
  [/\bbasic\s+(?=[a-z0-9+/]*[0-9+/=])[a-z0-9+/]{4,}={0,2}/gi, 'Basic [token]'],
  // supabase publishable and secret keys
  [/\bsb_[a-z]+_[\w-]+/gi, '[key]'],
  // plain and percent-encoded emails (%40 is @, %2540 is %40 encoded again); the local part and
  // the labels are bounded by their rfc 5321 maximum lengths
  [/[\w.%+-]{1,64}(?:@|%40|%2540)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,}/gi, '[email]'],
  // secrets in query strings and fragments, e.g. ?apikey=... or #access_token=... (oauth)
  [
    /([?&#](?:apikey|api_key|access_token|refresh_token|id_token|provider_token|token|code|password|email)=)[^&#\s]*/gi,
    `$1${FILTERED}`,
  ],
  // credentials anywhere in a text, e.g. token: abc, refresh_token=abc, X-Refresh-Token: 'abc'.
  // the value stops at a bracket, so an already filtered value is left as it is
  [
    /\b([\w-]{0,40}?(?:token|password|passwd|secret|api[_-]?key))(\s*[:=]\s*["']?)[^\s&#,;"'[\]{}]+/gi,
    `$1$2${FILTERED}`,
  ],
];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

const isSensitiveKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return (
    SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part))
  );
};

const scrubJsonMembers = (text: string): string =>
  text.replace(JSON_STRING_MEMBER, (member, key: string, separator: string) =>
    isSensitiveKey(key) ? `"${key}"${separator}"${FILTERED}"` : member,
  );

/**
 * replaces failing rows, sensitive json members, emails, jwts, bearer and basic credentials,
 * supabase keys, query string secrets and key=value credentials in a text
 */
export const scrubText = (text: string): string =>
  TEXT_REPLACEMENTS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    scrubJsonMembers(text.replace(FAILING_ROW, `Failing row contains ${FILTERED}`)),
  );

/** drops the query string and the fragment of a url */
export const stripQuery = (url: string): string => url.replace(/[?#].*$/s, '');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** a deep copy of the value with sensitive keys dropped and every string scrubbed */
export const scrubValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((item: unknown) => scrubValue(item, depth + 1));
  // scrubRecord is defined below: both recurse into each other
  return isRecord(value) ? scrubRecord(value, depth) : value;
};

const scrubEntry = (key: string, value: unknown, depth: number): unknown =>
  URL_KEYS.has(key) && typeof value === 'string'
    ? stripQuery(scrubText(value))
    : scrubValue(value, depth + 1);

/** a deep copy of the record with sensitive keys dropped and every string scrubbed */
export const scrubRecord = (record: object, depth = 0): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !isSensitiveKey(key))
      .map(([key, value]) => [key, scrubEntry(key, value, depth)]),
  );

const withoutKeys = (record: object, keys: ReadonlySet<string>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));

// the event's user is never sent, not even its id or ip address
const DROPPED_EVENT_KEYS = new Set(['user', 'request']);

/** sentry beforeSend: no user, no request body, cookie or query string, every string scrubbed */
export const scrubEvent = (event: ErrorEvent): ErrorEvent => {
  const scrubbed = scrubRecord(withoutKeys(event, DROPPED_EVENT_KEYS));
  const request = event.request && scrubRecord(withoutKeys(event.request, DROPPED_REQUEST_KEYS));
  // the copies keep the shapes of the event and its request: values were only replaced or dropped.
  // an error event has no type (only transactions and other events do)
  return { ...scrubbed, type: undefined, ...(request && { request }) };
};

/** sentry beforeBreadcrumb: message and data scrubbed, urls without query string */
export const scrubBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => scrubRecord(breadcrumb);
