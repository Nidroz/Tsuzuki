import { describe, expect, it } from '@jest/globals';

import { FIXED_NOW } from '../../../../test/core/fixed-clock';
import {
  CatalogAbortedError,
  CatalogHttpError,
  CatalogNetworkError,
  CatalogResponseError,
  CatalogTimeoutError,
} from '../../errors/catalog-errors';
import { DEFAULT_RETRY_POLICY, backoffDelayMs, isRetryable, parseRetryAfter } from './retry-policy';

// just below 1, the largest value Math.random returns
const ALMOST_ONE = 1 - Number.EPSILON;

describe('isRetryable', () => {
  it.each([
    ['a 429', new CatalogHttpError(429, null), true],
    ['a 500', new CatalogHttpError(500, null), true],
    ['a 503 with Retry-After', new CatalogHttpError(503, 1_000), true],
    ['a 599', new CatalogHttpError(599, null), true],
    ['a network error', new CatalogNetworkError(), true],
    ['a timeout', new CatalogTimeoutError(10_000), true],
    ['a 400', new CatalogHttpError(400, null), false],
    ['a 404', new CatalogHttpError(404, null), false],
    ['a 499', new CatalogHttpError(499, null), false],
    ['a 600', new CatalogHttpError(600, null), false],
    ['a malformed response', new CatalogResponseError(), false],
    ['an abort', new CatalogAbortedError(), false],
    ['any other error', new TypeError('boom'), false],
    ['a non-error', 'boom', false],
  ])('%s: %p', (_, error, expected) => {
    expect(isRetryable(error)).toBe(expected);
  });
});

describe('backoffDelayMs', () => {
  it('waits between half and all of the doubled base delay', () => {
    const delays = [1, 2, 3].map((retry) => [
      backoffDelayMs(retry, DEFAULT_RETRY_POLICY, () => 0),
      backoffDelayMs(retry, DEFAULT_RETRY_POLICY, () => 0.5),
      backoffDelayMs(retry, DEFAULT_RETRY_POLICY, () => ALMOST_ONE),
    ]);

    expect(delays).toStrictEqual([
      [500, 750, 1_000],
      [1_000, 1_500, 2_000],
      [2_000, 3_000, 4_000],
    ]);
  });

  it('caps the delay at maxDelayMs', () => {
    const policy = { ...DEFAULT_RETRY_POLICY, maxDelayMs: 3_000 };

    expect(backoffDelayMs(3, policy, () => 0)).toBe(1_500);
    expect(backoffDelayMs(3, policy, () => ALMOST_ONE)).toBe(3_000);
    expect(backoffDelayMs(50, DEFAULT_RETRY_POLICY, () => ALMOST_ONE)).toBe(8_000);
  });

  it('returns whole milliseconds', () => {
    expect(backoffDelayMs(1, DEFAULT_RETRY_POLICY, () => 0.123_456)).toBe(562);
  });
});

describe('parseRetryAfter', () => {
  it.each([
    ['120', 120_000],
    ['0', 0],
    [' 5 ', 5_000],
    ['007', 7_000],
  ])('reads delta-seconds %p', (value, expected) => {
    expect(parseRetryAfter(value, FIXED_NOW)).toBe(expected);
  });

  it('keeps an absurdly large delta-seconds finite', () => {
    expect(parseRetryAfter('9'.repeat(400), FIXED_NOW)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('reads an http date as the time left until it', () => {
    // the fixed clock reads Thu, 01 Jan 2026 00:00:00 GMT
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', FIXED_NOW)).toBe(30_000);
    expect(parseRetryAfter('Fri, 02 Jan 2026 00:00:00 GMT', FIXED_NOW)).toBe(86_400_000);
  });

  it('reads an http date in the past as no wait', () => {
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', FIXED_NOW)).toBe(0);
  });

  it.each([
    ['Feb 30', 'Mon, 30 Feb 2026 00:00:00 GMT'],
    ['hour 24', 'Thu, 01 Jan 2026 24:00:00 GMT'],
    ['minute 60', 'Thu, 01 Jan 2026 00:60:00 GMT'],
    ['a two-digit year padded to four', 'Thu, 01 Jan 0050 00:00:00 GMT'],
    ['an rfc 850 date', 'Thursday, 01-Jan-26 00:00:30 GMT'],
    ['an asctime date', 'Thu Jan  1 00:00:30 2026'],
    ['an iso date', '2026-01-01T00:00:30Z'],
    ['another time zone', 'Thu, 01 Jan 2026 00:00:30 UTC'],
  ])('rejects %s', (_, value) => {
    expect(parseRetryAfter(value, FIXED_NOW)).toBeNull();
  });

  it.each([null, '', '   ', 'soon', '-5', '1.5', '1e3', '+5'])('rejects %p', (value) => {
    expect(parseRetryAfter(value, FIXED_NOW)).toBeNull();
  });
});
