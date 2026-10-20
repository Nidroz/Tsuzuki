import { describe, expect, it } from '@jest/globals';

import { calendarDateSchema, normalizeTimestamp, timestampSchema } from './timestamp';

// the Date#toISOString form every normalized timestamp has
const ISO_FORM = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// every invalid value is rejected by the schema and turned into null by the normalizer
const isRejected = (value: string): boolean =>
  !timestampSchema.safeParse(value).success && normalizeTimestamp(value) === null;

describe('normalizeTimestamp', () => {
  it('normalizes the supabase and the toISOString forms of one instant to the same string', () => {
    const fromSupabase = normalizeTimestamp('2026-02-10T20:30:00.123456+00:00');
    const fromClient = normalizeTimestamp('2026-02-10T20:30:00.123Z');

    expect(fromSupabase).toBe('2026-02-10T20:30:00.123Z');
    expect(fromClient).toBe(fromSupabase);
  });

  it('returns a toISOString value unchanged', () => {
    const value = new Date(Date.UTC(2026, 1, 10, 20, 30, 0, 5)).toISOString();
    expect(normalizeTimestamp(value)).toBe(value);
  });

  it.each<[string, string]>([
    ['2026-02-10T22:30:00+02:00', '2026-02-10T20:30:00.000Z'],
    ['2026-02-10T15:00:00-05:30', '2026-02-10T20:30:00.000Z'],
    ['2026-02-10T22:30:00+0200', '2026-02-10T20:30:00.000Z'],
    ['2026-02-10T22:30:00+02', '2026-02-10T20:30:00.000Z'],
    ['2026-02-10T20:30:00-00:00', '2026-02-10T20:30:00.000Z'],
    ['2026-03-01T01:00:00+05:00', '2026-02-28T20:00:00.000Z'],
    ['2026-12-31T23:30:00-01:00', '2027-01-01T00:30:00.000Z'],
  ])('converts the offset of %p to utc', (value, expected) => {
    expect(normalizeTimestamp(value)).toBe(expected);
  });

  it('truncates the fraction to milliseconds, never rounds', () => {
    expect(normalizeTimestamp('2026-02-10T20:30:59.9999999Z')).toBe('2026-02-10T20:30:59.999Z');
    expect(normalizeTimestamp('2026-12-31T23:59:59.999999+00:00')).toBe('2026-12-31T23:59:59.999Z');
  });

  it.each<[string, string]>([
    ['', '.000'],
    ['.1', '.100'],
    ['.12', '.120'],
    ['.123', '.123'],
    ['.1234', '.123'],
    ['.123456', '.123'],
    ['.123456789', '.123'],
  ])('reads the fraction %p as %p', (fraction, milliseconds) => {
    expect(normalizeTimestamp(`2026-02-10T20:30:00${fraction}Z`)).toBe(
      `2026-02-10T20:30:00${milliseconds}Z`,
    );
  });

  it('accepts 29 february of a leap year', () => {
    expect(normalizeTimestamp('2024-02-29T12:00:00Z')).toBe('2024-02-29T12:00:00.000Z');
  });

  it('accepts the stored year bounds', () => {
    expect(normalizeTimestamp('0001-01-01T00:00:00Z')).toBe('0001-01-01T00:00:00.000Z');
    expect(normalizeTimestamp('9999-12-31T23:59:59.999Z')).toBe('9999-12-31T23:59:59.999Z');
  });

  it.each([
    ['a lowercase t', '2026-02-10t20:30:00Z'],
    ['a lowercase z', '2026-02-10T20:30:00z'],
    ['a space separator', '2026-02-10 20:30:00Z'],
    ['no offset', '2026-02-10T20:30:00'],
    ['no offset after a fraction', '2026-02-10T20:30:00.123'],
    ['a date only', '2026-02-10'],
    ['30 february', '2026-02-30T00:00:00Z'],
    ['29 february of a common year', '2025-02-29T00:00:00Z'],
    ['month 13', '2026-13-01T00:00:00Z'],
    ['month 00', '2026-00-10T00:00:00Z'],
    ['day 00', '2026-02-00T00:00:00Z'],
    ['hour 24', '2026-02-10T24:00:00Z'],
    ['minute 60', '2026-02-10T20:60:00Z'],
    ['second 60', '2026-02-10T20:30:60Z'],
    ['a bare dot', '2026-02-10T20:30:00.Z'],
    ['ten fraction digits', '2026-02-10T20:30:00.1234567890Z'],
    ['an offset hour of 24', '2026-02-10T20:30:00+24:00'],
    ['an offset minute of 60', '2026-02-10T20:30:00+01:60'],
    ['an offset with a trailing colon', '2026-02-10T20:30:00+01:'],
    ['an offset with seconds', '2026-02-10T20:30:00+01:00:00'],
    ['year 0000', '0000-01-01T00:00:00Z'],
    ['a utc result in year 0', '0001-01-01T00:30:00+01:00'],
    ['a utc result past 9999', '9999-12-31T23:30:00-01:00'],
    ['a five-digit year', '10000-01-01T00:00:00Z'],
    ['a signed year', '+002026-02-10T20:30:00Z'],
    ['surrounding whitespace', ' 2026-02-10T20:30:00Z'],
    ['the empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(isRejected(value)).toBe(true);
  });
});

describe('timestampSchema', () => {
  it('outputs the normalized timestamp', () => {
    expect(timestampSchema.parse('2026-02-10T22:30:00.5+02:00')).toBe('2026-02-10T20:30:00.500Z');
  });

  it.each<[string, unknown]>([
    ['a number', 1_770_755_400_000],
    ['a Date', new Date(Date.UTC(2026, 1, 10))],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, value) => {
    expect(timestampSchema.safeParse(value).success).toBe(false);
  });

  it('reports an issue without the value', () => {
    const value = '2026-02-30T00:00:00Z';
    const result = timestampSchema.safeParse(value);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(value);
  });

  // the BR-08 merge compares the guest updatedAt with the row updated_at as plain strings
  it('gives normalized timestamps a string order equal to their time order', () => {
    // in time order; the third and the fourth fall in the same millisecond
    const inTimeOrder = [
      '0999-05-01T00:00:00Z',
      '2026-02-10T21:00:00+01:00',
      '2026-02-10T20:30:00.000400+00:00',
      '2026-02-10T20:30:00.0009Z',
      '2026-02-10T20:30:00.001Z',
      '2026-02-10T20:30:01Z',
      '2026-02-10T19:00:00-02:00',
    ];
    const normalized = inTimeOrder.map((value) => timestampSchema.parse(value));
    for (const value of normalized) {
      expect(value).toMatch(ISO_FORM);
    }

    expect(normalized[0]).toBe('0999-05-01T00:00:00.000Z');
    expect(normalized[2]).toBe(normalized[3]);
    expect([...normalized].reverse().sort()).toStrictEqual(normalized);
    expect(new Set(normalized).size).toBe(inTimeOrder.length - 1);
  });

  it('orders raw strings of different offsets wrongly, normalized ones rightly', () => {
    // 20:45+00:00 is later than 21:30+01:00 (20:30 utc), the raw strings say the opposite
    const later = '2026-02-10T20:45:00+00:00';
    const earlier = '2026-02-10T21:30:00+01:00';

    const raw: string[] = [later, earlier];

    expect([...raw].sort()).toStrictEqual([later, earlier]);
    expect(raw.map((value) => timestampSchema.parse(value)).sort()).toStrictEqual([
      '2026-02-10T20:30:00.000Z',
      '2026-02-10T20:45:00.000Z',
    ]);
  });
});

describe('calendarDateSchema', () => {
  it.each(['2026-01-05', '2024-02-29', '0001-01-01', '9999-12-31'])('accepts %p as is', (value) => {
    expect(calendarDateSchema.parse(value)).toBe(value);
  });

  it.each([
    ['29 february of a common year', '2025-02-29'],
    ['31 april', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['day 00', '2026-01-00'],
    ['year 0000', '0000-01-01'],
    ['a one-digit month', '2026-1-05'],
    ['a five-digit year', '10000-01-01'],
    ['a timestamp', '2026-01-05T00:00:00Z'],
    ['slashes', '2026/01/05'],
    ['the empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a number', 20_260_105],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(calendarDateSchema.safeParse(value).success).toBe(false);
  });
});
