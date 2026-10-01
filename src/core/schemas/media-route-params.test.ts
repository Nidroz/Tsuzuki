import { describe, expect, it } from '@jest/globals';

import { MAL_ID_MAX, type MediaKey } from '../domain/media';
import { mediaRouteParamsSchema, parseMediaRouteParams } from './media-route-params';

// expo-router hands each param as a string, or as an array when the param is repeated
const params = (kind: unknown, id: unknown): Record<string, unknown> => ({ kind, id });

// every invalid input is rejected by the schema and turned into null by the parser
const isRejected = (raw: unknown): boolean =>
  !mediaRouteParamsSchema.safeParse(raw).success && parseMediaRouteParams(raw) === null;

describe('parseMediaRouteParams', () => {
  describe('valid params', () => {
    it.each<[string, Record<string, unknown>, MediaKey]>([
      ['an anime', params('anime', '1'), { kind: 'anime', malId: 1 }],
      ['a manga', params('manga', '1'), { kind: 'manga', malId: 1 }],
      ['a typical anime id', params('anime', '5114'), { kind: 'anime', malId: 5114 }],
      ['a typical manga id', params('manga', '2'), { kind: 'manga', malId: 2 }],
      ['an id with inner zeros', params('anime', '1000'), { kind: 'anime', malId: 1000 }],
      ['the largest id', params('manga', String(MAL_ID_MAX)), { kind: 'manga', malId: MAL_ID_MAX }],
    ])('parses %s into a media key', (_label, raw, expected) => {
      expect(parseMediaRouteParams(raw)).toStrictEqual(expected);
      expect(mediaRouteParamsSchema.parse(raw)).toStrictEqual(expected);
    });

    it('converts the id to a number', () => {
      const key = parseMediaRouteParams(params('anime', '42'));
      expect(typeof key?.malId).toBe('number');
      expect(key?.malId).toBe(42);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown string param', { kind: 'anime', id: '1', ref: 'x' }],
      ['a repeated unknown param', { kind: 'anime', id: '1', tab: ['a', 'b'] }],
      ['a param named like the output', { kind: 'anime', id: '1', malId: '99' }],
      ['several unknown params', { kind: 'anime', id: '1', a: '1', b: 2, c: null }],
    ])('ignores %s and returns only kind and malId', (_label, raw) => {
      const expected: MediaKey = { kind: 'anime', malId: 1 };
      expect(parseMediaRouteParams(raw)).toStrictEqual(expected);
      expect(mediaRouteParamsSchema.parse(raw)).toStrictEqual(expected);
    });

    it('does not modify the raw params', () => {
      const raw = { kind: 'manga', id: '7', ref: 'x' };
      parseMediaRouteParams(raw);
      expect(raw).toStrictEqual({ kind: 'manga', id: '7', ref: 'x' });
    });
  });

  describe('invalid id', () => {
    it.each<[string, string]>([
      ['zero', '0'],
      ['a negative id', '-1'],
      ['a leading zero', '01'],
      ['only zeros', '00'],
      ['a decimal', '1.5'],
      ['a trailing decimal point', '1.'],
      ['an exponent', '1e3'],
      ['a hexadecimal literal', '0x10'],
      ['a numeric separator', '1_000'],
      ['a thousands separator', '1,000'],
      ['a leading space', ' 1'],
      ['a trailing space', '1 '],
      ['a trailing newline', '1\n'],
      ['a plus sign', '+1'],
      ['letters', 'abc'],
      ['digits then letters', '12abc'],
      ['the empty string', ''],
      ['non-ascii digits', '١٢'],
      ['full-width digits', '１２'],
      ['one past the largest id', '2147483648'],
      ['a 32-bit unsigned maximum', '4294967295'],
      ['one past the largest safe integer', '9007199254740993'],
      ['a huge digit string', '9'.repeat(400)],
      ['Infinity', 'Infinity'],
      ['NaN', 'NaN'],
    ])('rejects %s', (_label, id) => {
      expect(isRejected(params('anime', id))).toBe(true);
      expect(isRejected(params('manga', id))).toBe(true);
    });

    it.each<[string, unknown]>([
      ['a number', 1],
      ['a bigint', 1n],
      ['null', null],
      ['a boolean', true],
      ['an object', { value: '1' }],
    ])('rejects an id that is not a string (%s)', (_label, id) => {
      expect(isRejected(params('anime', id))).toBe(true);
    });
  });

  describe('invalid kind', () => {
    it.each<[string, string]>([
      ['an unknown kind', 'movie'],
      ['a capitalized kind', 'Anime'],
      ['an upper-case kind', 'ANIME'],
      ['a capitalized manga', 'Manga'],
      ['the empty string', ''],
      ['a trailing space', 'anime '],
      ['a leading space', ' anime'],
      ['an object prototype key', 'toString'],
      ['the prototype accessor', '__proto__'],
    ])('rejects %s', (_label, kind) => {
      expect(isRejected(params(kind, '1'))).toBe(true);
    });

    it.each<[string, unknown]>([
      ['a number', 0],
      ['null', null],
      ['a boolean', false],
    ])('rejects a kind that is not a string (%s)', (_label, kind) => {
      expect(isRejected(params(kind, '1'))).toBe(true);
    });
  });

  describe('repeated params', () => {
    it.each<[string, Record<string, unknown>]>([
      ['a repeated kind', params(['anime'], '1')],
      ['a kind repeated twice', params(['anime', 'manga'], '1')],
      ['a repeated id', params('anime', ['1'])],
      ['an id repeated twice', params('anime', ['1', '2'])],
      ['an empty array id', params('anime', [])],
      ['both repeated', params(['anime'], ['1'])],
    ])('rejects %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });

  describe('missing params', () => {
    it.each<[string, Record<string, unknown>]>([
      ['a missing kind', { id: '1' }],
      ['a missing id', { kind: 'anime' }],
      ['both missing', {}],
      ['an undefined kind', { kind: undefined, id: '1' }],
      ['an undefined id', { kind: 'anime', id: undefined }],
      ['only unknown params', { ref: 'x' }],
    ])('rejects %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });

  describe('non-object input', () => {
    it.each<[string, unknown]>([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'anime/1'],
      ['a number', 1],
      ['a boolean', true],
      ['an array', ['anime', '1']],
      ['an empty array', []],
      ['a function', () => ({ kind: 'anime', id: '1' })],
    ])('returns null for %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });
});
