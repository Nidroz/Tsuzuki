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

// request parts that are never sent: bodies, cookies, query strings and the environment
const DROPPED_REQUEST_KEYS = new Set(['data', 'cookies', 'query_string', 'env']);

// deeper values are dropped: an event is never that deep, a cycle would be
const MAX_DEPTH = 12;

const FILTERED = '[Filtered]';
const PHONE = '[phone]';

// a postgres constraint error quotes the whole row, notes included: everything after it goes
const FAILING_ROW = /\bfailing row contains\b.*/gis;

// a quoted string member embedded in a text: json {"notes":"..."}, a python repr {'notes': '...'},
// a js object literal {notes: '...'} or mixed quotes {'notes': "l'episode"}. the key is bare or
// quoted (same quote on both sides), the value quote is chosen independently and the key is checked
// in code. the two branches of the value never match the same character, so a failed match
// backtracks linearly
const STRING_MEMBER = /(["']?)([\w-]{1,64})\1(\s*:\s*)(["'])(?:(?!\4)[^\\]|\\[\s\S])*\4/g;

// phone numbers written with separators only: a plain digit run (an id, a timestamp) is kept.
// international: + then 8 to 15 digits (e.164), each one preceded by at most two of space . - ( ),
// e.g. +33 6 12 34 56 78 or +1 (555) 123-4567
const INTERNATIONAL_PHONE = /\+(?:[ .()-]{0,2}\d){8,15}(?!\d)/g;
// national, grouped: a trunk 0 and four separated digit pairs (06 12 34 56 78, 06.12.34.56.78),
// and the north american (555) 123-4567 or 555-123-4567. dotted digit groups such as 100.200.3000
// match too: an accepted, harmless over-scrub
const NATIONAL_PHONE = /\b0\d(?:[ .-]\d{2}){4}\b|(?:\(\d{3}\) ?|\b\d{3}[ .-])\d{3}[ .-]\d{4}\b/g;

// free-text notes in a form body or a log line, e.g. notes=rewatch with my sister or userNote=...,
// up to the next & or the end of the line
const NOTES_ASSIGNMENT = /\b([\w-]{0,40}?notes?=)[^&\r\n]*/gi;

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
  // separated phone numbers, international first: the country code belongs to the number
  [INTERNATIONAL_PHONE, PHONE],
  [NATIONAL_PHONE, PHONE],
  [NOTES_ASSIGNMENT, `$1${FILTERED}`],
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

const scrubMembers = (text: string): string =>
  text.replace(
    STRING_MEMBER,
    (member, keyQuote: string, key: string, separator: string, valueQuote: string) =>
      isSensitiveKey(key)
        ? `${keyQuote}${key}${keyQuote}${separator}${valueQuote}${FILTERED}${valueQuote}`
        : member,
  );

/**
 * replaces failing rows, sensitive quoted string members, emails, jwts, bearer and basic
 * credentials, supabase keys, separated phone numbers, notes=..., query string secrets and
 * key=value credentials in a text
 */
export const scrubText = (text: string): string =>
  TEXT_REPLACEMENTS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    scrubMembers(text.replace(FAILING_ROW, `Failing row contains ${FILTERED}`)),
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
