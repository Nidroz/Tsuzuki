import { describe, expect, it } from '@jest/globals';

import { EXTERNAL_ID_MAX, type MediaKey } from '../domain/media';
import { mediaRouteParamsSchema, parseMediaRouteParams } from './media-route-params';

// expo-router hands each param as a string, or as an array when the param is repeated
const params = (
  kind: unknown,
  id: unknown,
  namespace: unknown = 'mal',
): Record<string, unknown> => ({
  namespace,
  kind,
  id,
});

const malKey = (kind: MediaKey['kind'], externalId: number): MediaKey => ({
  namespace: 'mal',
  kind,
  externalId,
});

// every invalid input is rejected by the schema and turned into null by the parser
const isRejected = (raw: unknown): boolean =>
  !mediaRouteParamsSchema.safeParse(raw).success && parseMediaRouteParams(raw) === null;

describe('parseMediaRouteParams', () => {
  describe('valid params', () => {
    it.each<[string, Record<string, unknown>, MediaKey]>([
      ['an anime', params('anime', '1'), malKey('anime', 1)],
      ['a manga', params('manga', '1'), malKey('manga', 1)],
      ['a typical anime id', params('anime', '5114'), malKey('anime', 5114)],
      ['a typical manga id', params('manga', '2'), malKey('manga', 2)],
      ['an id with inner zeros', params('anime', '1000'), malKey('anime', 1000)],
      [
        'the largest id',
        params('manga', String(EXTERNAL_ID_MAX)),
        malKey('manga', EXTERNAL_ID_MAX),
      ],
    ])('parses %s into a media key', (_label, raw, expected) => {
      expect(parseMediaRouteParams(raw)).toStrictEqual(expected);
      expect(mediaRouteParamsSchema.parse(raw)).toStrictEqual(expected);
    });

    it('converts the id to a number', () => {
      const key = parseMediaRouteParams(params('anime', '42'));
      expect(typeof key?.externalId).toBe('number');
      expect(key?.externalId).toBe(42);
    });

    it.each<[string, Record<string, unknown>]>([
      ['an unknown string param', { ...params('anime', '1'), ref: 'x' }],
      ['a repeated unknown param', { ...params('anime', '1'), tab: ['a', 'b'] }],
      ['a param named like the output', { ...params('anime', '1'), externalId: '99' }],
      ['several unknown params', { ...params('anime', '1'), a: '1', b: 2, c: null }],
    ])('ignores %s and returns only namespace, kind and externalId', (_label, raw) => {
      const expected = malKey('anime', 1);
      expect(parseMediaRouteParams(raw)).toStrictEqual(expected);
      expect(mediaRouteParamsSchema.parse(raw)).toStrictEqual(expected);
    });

    it('does not modify the raw params', () => {
      const raw = { namespace: 'mal', kind: 'manga', id: '7', ref: 'x' };
      parseMediaRouteParams(raw);
      expect(raw).toStrictEqual({ namespace: 'mal', kind: 'manga', id: '7', ref: 'x' });
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

  describe('invalid namespace', () => {
    it.each<[string, string]>([
      ['an unknown namespace', 'anilist'],
      ['an upper-case namespace', 'MAL'],
      ['a capitalized namespace', 'Mal'],
      ['a server id', 'tenrai'],
      ['the empty string', ''],
      ['a trailing space', 'mal '],
      ['an object prototype key', 'toString'],
    ])('rejects %s', (_label, namespace) => {
      expect(isRejected(params('anime', '1', namespace))).toBe(true);
    });

    it.each<[string, unknown]>([
      ['a number', 0],
      ['null', null],
      ['an object', { value: 'mal' }],
    ])('rejects a namespace that is not a string (%s)', (_label, namespace) => {
      expect(isRejected(params('anime', '1', namespace))).toBe(true);
    });
  });

  describe('repeated params', () => {
    it.each<[string, Record<string, unknown>]>([
      ['a repeated namespace', params('anime', '1', ['mal'])],
      ['a namespace repeated twice', params('anime', '1', ['mal', 'mal'])],
      ['a repeated kind', params(['anime'], '1')],
      ['a kind repeated twice', params(['anime', 'manga'], '1')],
      ['a repeated id', params('anime', ['1'])],
      ['an id repeated twice', params('anime', ['1', '2'])],
      ['an empty array id', params('anime', [])],
      ['all repeated', params(['anime'], ['1'], ['mal'])],
    ])('rejects %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });

  describe('missing params', () => {
    it.each<[string, Record<string, unknown>]>([
      ['a missing namespace', { kind: 'anime', id: '1' }],
      ['a missing kind', { namespace: 'mal', id: '1' }],
      ['a missing id', { namespace: 'mal', kind: 'anime' }],
      ['all missing', {}],
      ['an undefined namespace', { namespace: undefined, kind: 'anime', id: '1' }],
      ['an undefined kind', params(undefined, '1')],
      ['an undefined id', params('anime', undefined)],
      ['only unknown params', { ref: 'x' }],
    ])('rejects %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });

  describe('non-object input', () => {
    it.each<[string, unknown]>([
      ['null', null],
      ['undefined', undefined],
      ['a string', 'mal/anime/1'],
      ['a number', 1],
      ['a boolean', true],
      ['an array', ['mal', 'anime', '1']],
      ['an empty array', []],
      ['a function', () => params('anime', '1')],
    ])('returns null for %s', (_label, raw) => {
      expect(isRejected(raw)).toBe(true);
    });
  });
});
