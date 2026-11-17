import { describe, expect, it } from '@jest/globals';

import { jsonbText, jsonbTextBytes } from './jsonb-text';
import { MERGE_INPUT_BYTES_MAX } from './merge-function';
import { REPLAY_INPUT_BYTES_MAX } from './replay-function';

// the outputs postgres gives: the examples of its documentation (§8.14 "JSON Types", §9.16 "JSON
// Functions and Operators") and the sizes pgTAP 072-library-input-size asserts

// U+0001, a control character: 6 bytes in jsonb text
const CONTROL = '\u0001';
const INTEGER_MAX = 2_147_483_647;
// the replacement character U+FFFD (3 utf-8 bytes) and U+10000, the first code point of 4 bytes
// (a utf-16 surrogate pair)
const REPLACEMENT_CHARACTER = 0xfffd;
const FIRST_ASTRAL = 0x10000;

// pg_temp.max_entry of pgTAP 072: every column at its limit, every string of control characters
const maxEntry = (): Record<string, unknown> => ({
  id_namespace: 'mal',
  media_kind: 'manga',
  external_id: INTEGER_MAX,
  media_title: CONTROL.repeat(500),
  media_image_url: `https://${CONTROL.repeat(2040)}`,
  media_format: CONTROL.repeat(32),
  media_total_units: INTEGER_MAX,
  media_is_adult: false,
  status: 'completed',
  progress: INTEGER_MAX,
  score: null,
  notes: CONTROL.repeat(2000),
  is_favorite: false,
  started_at: '9999-12-31',
  finished_at: '9999-12-31',
  updated_at: '2026-01-15T08:00:00.123456+14:00',
});

describe('jsonbText', () => {
  it.each([
    {
      label: 'orders the keys by length, then bytewise (docs §8.14)',
      input: '{"bar": "baz", "balance": 7.77, "active":false}',
      output: '{"bar": "baz", "active": false, "balance": 7.77}',
    },
    {
      label: 'separates array elements with ", " (docs §8.14)',
      input: '[1, 2, "foo", null]',
      output: '[1, 2, "foo", null]',
    },
    {
      label: 'writes nested values in the same form (docs §9.16 jsonb_set)',
      input: '[{"f1":[2,3,4],"f2":null},2,null,3]',
      output: '[{"f1": [2, 3, 4], "f2": null}, 2, null, 3]',
    },
    {
      label: 'puts a shorter key first whatever its spelling (docs §9.16 jsonb_build_object)',
      input: '{"foo": 1, "2": {"f1": 3, "f2": "bar"}}',
      output: '{"2": {"f1": 3, "f2": "bar"}, "foo": 1}',
    },
    {
      label: 'escapes quotes in strings (docs §9.16 to_jsonb)',
      input: '{"f1": 42, "f2": "Fred said \\"Hi.\\""}',
      output: '{"f1": 42, "f2": "Fred said \\"Hi.\\""}',
    },
    {
      label:
        'writes a number in plain digits (docs §8.14, its 1.230e-5 without the zero JSON.parse drops)',
      input: '{"reading": 1.23e-5}',
      output: '{"reading": 0.0000123}',
    },
    { label: 'writes empty containers', input: '{"a": {}, "b": []}', output: '{"a": {}, "b": []}' },
  ])('$label', ({ input, output }) => {
    expect(jsonbText(JSON.parse(input))).toBe(output);
  });

  it('escapes as escape_json does: short escapes, lowercase \\u00xx, everything else as is', () => {
    expect(jsonbText('a\u0001\u001f"\\\b\f\n\r\t/\u007fé')).toBe(
      String.raw`"a\u0001\u001f\"\\\b\f\n\r\t/` + '\u007fé"',
    );
  });

  it('orders keys by their utf-8 byte length, not their utf-16 length', () => {
    // "é" is 2 bytes, as long as "ab": bytewise after it
    expect(jsonbText({ ab: 1, é: 2, z: 3 })).toBe('{"z": 3, "ab": 1, "é": 2}');
  });

  it('orders keys of one byte length bytewise, not by utf-16 code unit', () => {
    // the replacement character then "a" (ef bf bd 61) comes before U+10000 (f0 90 80 80), whose
    // utf-16 units (d800 dc00) sort first
    const replacementThenA = `${String.fromCodePoint(REPLACEMENT_CHARACTER)}a`;
    const astral = String.fromCodePoint(FIRST_ASTRAL);

    expect(jsonbText({ [astral]: 1, [replacementThenA]: 2 })).toBe(
      `{"${replacementThenA}": 2, "${astral}": 1}`,
    );
  });

  it.each([
    { value: INTEGER_MAX, text: '2147483647' },
    { value: -5, text: '-5' },
    { value: -0, text: '0' },
    { value: 1e21, text: '1000000000000000000000' },
    { value: -1.5e-7, text: '-0.00000015' },
    { value: 12.5e22, text: '125000000000000000000000' },
  ])('writes the number $value as $text', ({ value, text }) => {
    expect(jsonbText(value)).toBe(text);
  });

  it('refuses what is not a json value', () => {
    expect(() => jsonbText(undefined)).toThrow(TypeError);
    expect(() => jsonbText(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('jsonbTextBytes', () => {
  it('counts utf-8 bytes', () => {
    expect(jsonbTextBytes('é')).toBe(4);
    expect(jsonbTextBytes('\u{1F600}')).toBe(6);
    expect(jsonbTextBytes([CONTROL])).toBe(10);
  });

  it('sizes the maximal guest entry and queued save as pgTAP 072 does', () => {
    expect(jsonbTextBytes(maxEntry())).toBe(27_837);
    expect(jsonbTextBytes({ ...maxEntry(), op: 'save' })).toBe(27_851);
  });

  it('keeps the bounds of the functions: 100 elements of the worst case and their punctuation', () => {
    expect(MERGE_INPUT_BYTES_MAX).toBe(2_805_100);
    expect(REPLAY_INPUT_BYTES_MAX).toBe(2_806_500);
  });
});
