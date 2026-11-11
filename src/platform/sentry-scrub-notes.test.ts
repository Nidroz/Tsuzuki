import { describe, expect, it, jest } from '@jest/globals';

import { scrubText } from './sentry-scrub';

// a fake note: it must be absent from every scrubbed text
const NOTE = 'rewatch episode 3 with my sister';

describe('scrubText notes', () => {
  it.each([
    [`log notes: ${NOTE}`, 'log notes: [Filtered]'],
    [`Notes : ${NOTE}\nnext line`, 'Notes : [Filtered]\nnext line'],
    // a colon value is free text: it does not stop at &
    [`userNote:${NOTE} & more`, 'userNote:[Filtered]'],
    // any value that is not a string, up to the end of the line
    [`{"notes": ["${NOTE}"], "id": 1}`, '{"notes": [Filtered]'],
    // json inside a json string: the quotes are escaped
    [`{\\"notes\\":\\"${NOTE}\\"}`, '{\\"notes\\":[Filtered]'],
  ])('redacts the unquoted colon value in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    [`${'x'.repeat(41)}notes=${NOTE}`, `${'x'.repeat(41)}notes=[Filtered]`],
    [`${'a-'.repeat(40)}note=${NOTE}&id=1`, `${'a-'.repeat(40)}note=[Filtered]&id=1`],
    // longer than the 64 characters of a quoted member key
    [`{"${'k'.repeat(70)}Notes": "${NOTE}"}`, `{"${'k'.repeat(70)}Notes": "[Filtered]"}`],
    [`${'prefix_'.repeat(10)}notes: ${NOTE}`, `${'prefix_'.repeat(10)}notes: [Filtered]`],
  ])('redacts the note after a long key prefix in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    // an earlier value missing its closing quote
    [`{"title": "abc, "notes": "${NOTE}"}`, '{"title": "abc, "notes": "[Filtered]"}'],
    [`{'title': 'abc, 'notes': '${NOTE}'}`, "{'title': 'abc, 'notes': '[Filtered]'}"],
    // an earlier value ending with an escaped quote
    [`{"title": "a \\", "notes": "${NOTE}"}`, '{"title": "a \\", "notes": "[Filtered]"}'],
    // a note with no closing quote is redacted to the end of the text, the next note with it
    [`'notes': 'unterminated ${NOTE}, notes: "second"`, "'notes': '[Filtered]"],
    [`{"notes": "${NOTE}\nnext line`, '{"notes": "[Filtered]'],
  ])('finds the note after a malformed value in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    // an unescaped quote inside the note does not close it
    [`{'notes': 'j'adore l'episode', 'id': 1}`, "{'notes': '[Filtered]', 'id': 1}"],
    // a quoted note spanning lines
    [`notes: "${NOTE}\nline two" saved`, 'notes: "[Filtered]" saved'],
    ['form notes[0]=rewatch&id=1', 'form notes[0]=[Filtered]&id=1'],
    // every note of the text, each found on its own
    [
      `{"notes":"${NOTE}","userNotes":"${NOTE}"} notes=${NOTE}`,
      '{"notes":"[Filtered]","userNotes":"[Filtered]"} notes=[Filtered]',
    ],
  ])('redacts the whole note in %j', (input, expected) => {
    expect(scrubText(input)).toBe(expected);
  });

  it.each([
    'notes are synced',
    'at saveNotes (app:///index.bundle:12:3)',
    'LibraryNotesSheet.tsx:42:7',
    'noted 3 entries',
  ])('keeps the text without a notes value %j', (input) => {
    expect(scrubText(input)).toBe(input);
  });

  // accepted over-scrub: a key merely holding the word, such as footnote, loses its value too
  it('redacts the value of any key holding the word note', () => {
    expect(scrubText('footnote: see page 3')).toBe('footnote: [Filtered]');
  });
});

// about 100 KB each; a linear scan takes a few milliseconds, a quadratic one far beyond the budget
const LINEAR_TIME_BUDGET_MS = 1_000;

describe('scrubText notes on adversarial input', () => {
  it.each([
    ['one long run holding note', 'note'.repeat(25_000)],
    ['note keys with no separator', 'note '.repeat(20_000)],
    ['note keys with a quote and no separator', 'notes" '.repeat(14_000)],
    ['note keys with unclosed brackets', 'notes[note'.repeat(10_000)],
    ['an unterminated quoted note of escapes', `notes: '${"\\'x".repeat(33_000)}`],
    ['many quoted notes', "notes: 'x' ".repeat(9_000)],
    ['malformed members before notes', '{"a": "b, "notes'.repeat(6_000)],
    ['spaces before a missing separator', `notes${' '.repeat(100_000)}x`],
    ['note keys followed by spaces', `notes${' '.repeat(10)}`.repeat(6_500)],
  ])('scrubs %s within the time budget', (_, input) => {
    // the clock is fake by default: this test measures the real time spent
    jest.useRealTimers();
    const started = performance.now();

    scrubText(input);

    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
