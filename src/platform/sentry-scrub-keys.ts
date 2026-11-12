// the scans of sentry-scrub.ts that read a text one run of key characters at a time: the notes
// and the credentials, each value found whatever precedes its key, in bounded time

export const FILTERED = '[Filtered]';

// the user's notes: a key holding this word anywhere (notes, userNote, x-notes) holds one
export const NOTE_KEY_PART = 'note';

/** a key lowercased, without - and _, as the sensitive key parts are compared. */
export const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_]/g, '');

// the notes scan (scrubNotes) and the credentials scan (scrubCredentials) read the text one run of
// key characters (word characters and -) at a time, so a key is found whatever precedes it: a long
// prefix (a run is matched whole) or an earlier value with a missing or misplaced quote (no other
// value is ever consumed)
const KEY_RUN = /[\w-]+/g;
// what may follow a notes or credentials key: its closing quote, escaped too (json inside a json
// string), form array brackets (notes[0]=), then : or = between spaces. the spaces after it may
// cross a line break, so a value on the next line is redacted, and an empty one takes the next
// line with it
const KEY_SEPARATOR = /(?:\\?["'])?(?:\[[\w-]*\])*\s*([:=])\s*/y;
const ASSIGNMENT = '=';
// where an unquoted value ends: at the end of the line, or at the next & after = (a form body
// encodes its own &). a note is free text, so a colon value takes the rest of its line
const ASSIGNMENT_VALUE_END = /[&\r\n]/g;
const LINE_END = /[\r\n]/g;
const QUOTES: ReadonlySet<string> = new Set(['"', "'"]);
// a quote closes a quoted value only before one of these or the end of the text, so an unescaped
// quote inside the note (l'episode) does not end it early
const AFTER_CLOSING_QUOTE = /[\s,;}\])&]/;
// a backslash and the character it escapes
const ESCAPE_LENGTH = 2;
const BACKSLASH = '\\';

// a key holding one of these words (compared lowercased, without - and _) is a credentials key:
// token, refresh_token, X-Api-Key, passwordHash, client_secret, with a prefix of any length
const CREDENTIAL_KEY_PARTS = ['token', 'password', 'passwd', 'secret', 'apikey'];
// where an unquoted credential ends; a bracket too, so a value already filtered ([Filtered],
// [jwt]) is left as it is
const CREDENTIAL_VALUE_END = /[\s&#,;"'[\]{}]/g;

// the index of the quote closing the quoted value opened at start, or undefined when it has none.
// a plain loop: no regex backtracking on a long value
const closingQuoteIndex = (text: string, start: number, quote: string): number | undefined => {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (character === quote) {
      const next = text[index + 1];
      if (next === undefined || AFTER_CLOSING_QUOTE.test(next)) return index;
    }
    index += character === '\\' ? ESCAPE_LENGTH : 1;
  }
  return undefined;
};

// the index where the first match of the pattern after start begins, or the end of the text
const indexFrom = (text: string, start: number, pattern: RegExp): number => {
  pattern.lastIndex = start;
  return pattern.exec(text)?.index ?? text.length;
};

// where the value after a key ends, and what replaces it
interface KeyValue {
  readonly end: number;
  readonly replacement: string;
}

// the quoted value starting at start, up to its closing quote
const quotedValue = (text: string, start: number, quote: string): KeyValue => {
  const closing = closingQuoteIndex(text, start, quote);
  // a value with no closing quote is redacted to the end of the text: an over-scrub, never a miss
  return closing === undefined
    ? { end: text.length, replacement: `${quote}${FILTERED}` }
    : { end: closing + 1, replacement: `${quote}${FILTERED}${quote}` };
};

// the value of a notes key starting at start
const notesValue = (text: string, start: number, sign: string | undefined): KeyValue => {
  const quote = text[start];
  if (quote !== undefined && QUOTES.has(quote)) return quotedValue(text, start, quote);
  const valueEnd = sign === ASSIGNMENT ? ASSIGNMENT_VALUE_END : LINE_END;
  return { end: indexFrom(text, start, valueEnd), replacement: FILTERED };
};

// the value of a credentials key starting at start, or undefined when it is empty (a value already
// filtered, an array or an object). one opened by an escaped quote (json inside a json string) is
// redacted to the end of its line, as an unquoted notes value is
const credentialValue = (text: string, start: number): KeyValue | undefined => {
  const first = text[start];
  if (first !== undefined && QUOTES.has(first)) return quotedValue(text, start, first);
  const escaped = text[start + 1];
  if (first === BACKSLASH && escaped !== undefined && QUOTES.has(escaped)) {
    return { end: indexFrom(text, start, LINE_END), replacement: FILTERED };
  }
  const end = indexFrom(text, start, CREDENTIAL_VALUE_END);
  return end === start ? undefined : { end, replacement: FILTERED };
};

/**
 * replaces the value of every key run the predicate accepts, quoted or not, after : or =, whatever
 * precedes it. every character is read a bounded number of times (each run once, each value once)
 */
const scrubKeyValues = (
  text: string,
  isKey: (run: string) => boolean,
  valueAt: (text: string, start: number, sign: string | undefined) => KeyValue | undefined,
): string => {
  const parts: string[] = [];
  // the text before this index is already in parts
  let copied = 0;
  for (const run of text.matchAll(KEY_RUN)) {
    // a run inside a redacted value is gone with it
    if (run.index < copied || !isKey(run[0])) continue;
    KEY_SEPARATOR.lastIndex = run.index + run[0].length;
    const separator = KEY_SEPARATOR.exec(text);
    if (!separator) continue;
    const start = KEY_SEPARATOR.lastIndex;
    const value = valueAt(text, start, separator[1]);
    if (value === undefined) continue;
    parts.push(text.slice(copied, start), value.replacement);
    copied = value.end;
  }
  parts.push(text.slice(copied));
  return parts.join('');
};

const isNotesKey = (run: string): boolean => run.toLowerCase().includes(NOTE_KEY_PART);

const isCredentialKey = (run: string): boolean => {
  const normalized = normalizeKey(run);
  return CREDENTIAL_KEY_PARTS.some((part) => normalized.includes(part));
};

/** replaces the value of every key holding note. */
export const scrubNotes = (text: string): string => scrubKeyValues(text, isNotesKey, notesValue);

/**
 * replaces the value of every credentials key, e.g. token: abc, refresh_token=abc,
 * X-Refresh-Token: 'abc', or a "token" member after an earlier value with a missing quote
 */
export const scrubCredentials = (text: string): string =>
  scrubKeyValues(text, isCredentialKey, credentialValue);
