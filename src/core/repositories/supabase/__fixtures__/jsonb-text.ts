// the text postgres gives a jsonb value (`value::text`, JsonbToCString in jsonb.c), for the size
// bounds of the database functions (supabase/migrations/*_library_input_byte_bounds.sql), which
// compare octet_length(input::text). it differs from JSON.stringify: ", " between the elements and
// the members, ": " after a key, the keys of an object ordered by their utf-8 byte length, then
// bytewise (lengthCompareJsonbString), strings escaped as escape_json does (\b \f \n \r \t \" \\,
// any other control character as a lowercase \u00xx, every other code point as its utf-8 bytes),
// numbers as numeric_out writes them (plain digits, no exponent). the value is what JSON.parse
// read from the request: the spelling of a number's scale (1.50) is lost there, so a number is
// written in its shortest plain form; the client sends integers only. what jsonb refuses on input
// (a \u0000 escape, a lone surrogate) is not modelled: a lone surrogate counts as U+FFFD
import { isRecord } from './postgrest-fake';

const encoder = new TextEncoder();

// the first code point escape_json writes as itself: the space
const FIRST_PLAIN_CODE = 0x20;
const HEX_RADIX = 16;
const UNICODE_ESCAPE_DIGITS = 4;
const SHORT_ESCAPES: Readonly<Record<string, string>> = {
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '"': '\\"',
  '\\': '\\\\',
};
// a number's String form with an exponent: its integer digits, its fraction digits, its exponent
const EXPONENT_FORM = /^(\d+)(?:\.(\d+))?e([+-]\d+)$/;

const escapeCharacter = (character: string): string => {
  const short = SHORT_ESCAPES[character];
  if (short !== undefined) {
    return short;
  }
  const code = character.charCodeAt(0);
  return code < FIRST_PLAIN_CODE
    ? `\\u${code.toString(HEX_RADIX).padStart(UNICODE_ESCAPE_DIGITS, '0')}`
    : character;
};

const stringText = (value: string): string => `"${Array.from(value, escapeCharacter).join('')}"`;

// the plain decimal digits of a non-negative finite number, as numeric_out writes them
const plainDigits = (value: number): string => {
  const text = String(value);
  const match = EXPONENT_FORM.exec(text);
  if (match === null) {
    return text;
  }
  const [, integer = '', fraction = '', exponent = ''] = match;
  const digits = `${integer}${fraction}`;
  const point = integer.length + Number(exponent);
  if (point <= 0) {
    return `0.${'0'.repeat(-point)}${digits}`;
  }
  return point >= digits.length
    ? `${digits}${'0'.repeat(point - digits.length)}`
    : `${digits.slice(0, point)}.${digits.slice(point)}`;
};

const numberText = (value: number): string => {
  if (!Number.isFinite(value)) {
    throw new RangeError('the jsonb text fake writes finite numbers only');
  }
  return value < 0 ? `-${plainDigits(-value)}` : plainDigits(value);
};

// lengthCompareJsonbString: the shorter utf-8 key first, then the bytes in order
const compareKeys = (left: string, right: string): number => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) {
    return a.length - b.length;
  }
  const index = a.findIndex((byte, at) => byte !== b[at]);
  return index === -1 ? 0 : (a[index] ?? 0) - (b[index] ?? 0);
};

/** the text of `value`, a value JSON.parse returned, as postgres writes it for jsonb. */
export const jsonbText = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => jsonbText(item)).join(', ')}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort(compareKeys);
    return `{${keys.map((key) => `${stringText(key)}: ${jsonbText(value[key])}`).join(', ')}}`;
  }
  switch (typeof value) {
    case 'boolean':
      return String(value);
    case 'number':
      return numberText(value);
    case 'string':
      return stringText(value);
    default:
      throw new TypeError('the jsonb text fake writes json values only');
  }
};

/** octet_length(value::text) of `value` as jsonb: the utf-8 bytes of jsonbText. */
export const jsonbTextBytes = (value: unknown): number => encoder.encode(jsonbText(value)).length;
