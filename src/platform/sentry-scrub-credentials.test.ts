import { describe, expect, it } from '@jest/globals';

import { scrubText } from './sentry-scrub';

// a fake credential: it must be absent from every scrubbed text
const SECRET = 'qqqqqqqqqqqq';

describe('scrubText credentials', () => {
  it.each([
    // one character past the 40 the former pattern allowed before the word
    [`${'a'.repeat(41)}token: ${SECRET}`, `${'a'.repeat(41)}token: [Filtered]`],
    [`${'a'.repeat(41)}_password=${SECRET}`, `${'a'.repeat(41)}_password=[Filtered]`],
    [`${'k'.repeat(250)}Secret = ${SECRET} next`, `${'k'.repeat(250)}Secret = [Filtered] next`],
    [`${'x-'.repeat(120)}api-key: ${SECRET}`, `${'x-'.repeat(120)}api-key: [Filtered]`],
    [
      `${'prefix_'.repeat(40)}api_key=${SECRET}&next=1`,
      `${'prefix_'.repeat(40)}api_key=[Filtered]&next=1`,
    ],
    // longer than the 64 characters of a quoted member key
    [`{"${'k'.repeat(70)}Token": "${SECRET}"}`, `{"${'k'.repeat(70)}Token": "[Filtered]"}`],
  ])('redacts the credential after a long key prefix in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    // an earlier value missing its closing quote, in both quote styles
    [`{"title": "abc, "token": "${SECRET}"}`, '{"title": "abc, "token": "[Filtered]"}'],
    [`{'title': 'abc, 'token': '${SECRET}'}`, "{'title': 'abc, 'token': '[Filtered]'}"],
    [
      `{"title": "abc, "refresh_token": "${SECRET}", "id": 1}`,
      '{"title": "abc, "refresh_token": "[Filtered]", "id": 1}',
    ],
    [`{'title': 'abc, "password": "${SECRET}"}`, `{'title': 'abc, "password": "[Filtered]"}`],
    // an earlier value ending with an escaped quote
    [`{"title": "a \\", "token": "${SECRET}"}`, '{"title": "a \\", "token": "[Filtered]"}'],
  ])('finds the credential after a malformed value in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    [`token=${SECRET}`, 'token=[Filtered]'],
    [`token = ${SECRET} retry`, 'token = [Filtered] retry'],
    [`token:${SECRET}`, 'token:[Filtered]'],
    [`token : ${SECRET}, retry`, 'token : [Filtered], retry'],
    [`token:\n${SECRET}`, 'token:\n[Filtered]'],
    [`password[confirm]=${SECRET}&x=1`, 'password[confirm]=[Filtered]&x=1'],
    [`"token":"${SECRET}"`, '"token":"[Filtered]"'],
    // a quoted value is redacted up to its closing quote, spaces included
    [`password: '${SECRET} ${SECRET}' saved`, "password: '[Filtered]' saved"],
    // json inside a json string: the quotes are escaped, the rest of the line goes
    [`{\\"token\\":\\"${SECRET}\\"} rest\nnext line`, '{\\"token\\":[Filtered]\nnext line'],
  ])('redacts the = and : forms in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    'token expired',
    'the secret ending',
    'sent Bearer [token]',
    // a value the patterns already replaced is not filtered twice
    'refresh token: [jwt]',
    '/auth?token=[Filtered]&type=recovery',
  ])('keeps the text without a credential value %j', (input) => {
    expect(scrubText(input)).toBe(input);
  });

  // accepted over-scrubs: a key merely holding a word loses its value, and a quoted value with no
  // closing quote takes the rest of the text
  it.each([
    ['tokens: 3 left', 'tokens: [Filtered] left'],
    ['secretary: Ann', 'secretary: [Filtered]'],
    [`token: '${SECRET} and the rest`, "token: '[Filtered]"],
  ])('over-scrubs %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });
});

// about 100 KB each: a linear scan takes a few milliseconds, while a quadratic one (about 10^10
// steps) would run past the test timeout. no clock is read here: tests never use real time
// (CONTRIBUTING.md section 6)
describe('scrubText credentials on adversarial input', () => {
  it.each([
    ['one long run holding token', 'token'.repeat(20_000)],
    ['credential keys with no separator', 'token '.repeat(16_000)],
    ['credential keys with a quote and no separator', 'token" '.repeat(14_000)],
    ['credential keys with unclosed brackets', 'token[token'.repeat(9_000)],
    ['an unterminated quoted credential of escapes', `token: '${"\\'x".repeat(33_000)}`],
    ['many quoted credentials', "token: 'x' ".repeat(9_000)],
    ['malformed members before credentials', '{"a": "b, "token'.repeat(6_000)],
    ['spaces before a missing separator', `token${' '.repeat(100_000)}x`],
    ['credential keys followed by spaces', `token${' '.repeat(10)}`.repeat(6_500)],
    ['long key prefixes', `${'a'.repeat(1_000)}token=x `.repeat(100)],
    ['chained assignments', 'token=token='.repeat(8_000)],
    ['an escaped quote with no line end', `token:\\"${'x'.repeat(100_000)}`],
  ])('scrubs %s, leaving no credential in clear', (_, input) => {
    const scrubbed = scrubText(input);

    expect(typeof scrubbed).toBe('string');
    expect(scrubbed).not.toMatch(/token["']?\s*[:=]\s*(?:\\?["'])?x/);
  });
});
